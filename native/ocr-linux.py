#!/usr/bin/env python3
"""Stand-in for build/ocr on a host that has no Vision.

native/ocr.swift prints the same JSON from an Apple recognizer; this reads the same image with
tesseract and prints the same shape, so nothing above it has to know which host it runs on.

    {"text": str, "confidence": float, "x": px, "y": px, "width": px, "height": px}

Coordinates are pixels of the image that was handed in, which the caller has already scaled to
screen points, so a recognized box can be compared with accessibility frames unchanged.
"""

import atexit
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile

LANGUAGES = os.environ.get('POKI_OCR_LANGS', 'chi_sim+eng')
# Sparse text: a screen is a collection of labels, not a page of prose.
PSM = os.environ.get('POKI_OCR_PSM', '11')
# A point-sized screenshot is small for Chinese glyphs; recognizing a doubled copy and halving the
# boxes back is far more accurate than reading the original.
UPSCALE = int(os.environ.get('POKI_OCR_UPSCALE', '2'))
MIN_WIDTH = 700


# Copies made here are removed on the way out, including when the daemon stops a slow run with
# SIGTERM: that skips `finally`, which is how they used to be left beside the frame they came from.
_temporary = []


def _discard_temporary():
    while _temporary:
        try:
            os.unlink(_temporary.pop())
        except OSError:
            pass


def _on_signal(signum, _frame):
    _discard_temporary()
    raise SystemExit(128 + signum)


def enlarge(path):
    """Return (path to read, factor). Falls back to the original when Pillow is absent."""
    if UPSCALE <= 1:
        return path, 1
    try:
        from PIL import Image
    except ImportError:
        return path, 1
    try:
        image = Image.open(path)
        if image.width >= MIN_WIDTH:
            return path, 1
        big = image.resize((image.width * UPSCALE, image.height * UPSCALE), Image.LANCZOS)
        # Outside the frame directory on purpose, and named, so a killed run leaves at most one file
        # under the host's temporary directory rather than a growing set next to the screenshots.
        handle, out = tempfile.mkstemp(prefix='poki-ocr-', suffix='.png')
        os.close(handle)
        _temporary.append(out)
        big.save(out)
        return out, UPSCALE
    except Exception:
        return path, 1


def tesseract(path, psm):
    result = subprocess.run(
        ['tesseract', path, 'stdout', '-l', LANGUAGES, '--psm', str(psm), 'tsv'],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, 'OMP_THREAD_LIMIT': '1'},
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or 'tesseract failed').strip()[-500:])
    return result.stdout


def collect(tsv, factor):
    """Group word rows into the text lines a screen actually shows."""
    grouped = {}
    order = []
    for row in tsv.splitlines()[1:]:
        field = row.split('\t')
        if len(field) < 12 or field[0] != '5':
            continue
        text = field[11].strip()
        if not text:
            continue
        try:
            confidence = float(field[10])
            left, top, width, height = (int(value) for value in field[6:10])
        except ValueError:
            continue
        if confidence < 0 or width <= 0 or height <= 0:
            continue
        key = (field[2], field[3], field[4])
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append((text, confidence, left, top, width, height))

    lines = []
    for key in order:
        words = sorted(grouped[key], key=lambda word: word[2])
        text = ''
        for word in words:
            # Chinese does not space between words; Latin does.
            if text and not (_cjk(text[-1]) and _cjk(word[0][0])):
                text += ' '
            text += word[0]
        boxes = [(word[2], word[3], word[2] + word[4], word[3] + word[5]) for word in words]
        left = min(box[0] for box in boxes)
        top = min(box[1] for box in boxes)
        right = max(box[2] for box in boxes)
        bottom = max(box[3] for box in boxes)
        lines.append({
            'text': text,
            'confidence': round(sum(word[1] for word in words) / len(words) / 100, 4),
            'x': left / factor,
            'y': top / factor,
            'width': (right - left) / factor,
            'height': (bottom - top) / factor,
        })
    lines.sort(key=lambda line: (line['y'], line['x']))
    return lines


def _cjk(character):
    return '\u3000' <= character <= '\u9fff' or '\uff00' <= character <= '\uffef'


def main():
    if len(sys.argv) != 2:
        print('Expected a readable image path', file=sys.stderr)
        return 1
    source = sys.argv[1]
    if not shutil.which('tesseract'):
        print('tesseract is not installed; install tesseract-ocr and a language pack', file=sys.stderr)
        return 1
    atexit.register(_discard_temporary)
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    prepared, factor = enlarge(source)
    try:
        text = tesseract(prepared, PSM)
        lines = collect(text, factor)
        if not lines and PSM != '6':
            # A single column of UI labels sometimes needs the block layout instead.
            lines = collect(tesseract(prepared, '6'), factor)
    finally:
        if prepared != source:
            _discard_temporary()
    print(json.dumps(lines, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
