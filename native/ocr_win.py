#!/usr/bin/env python3
"""Text recognition for a screenshot, with the same output as native/ocr.swift.

Vision is macOS-only, so this helper reproduces its contract with a different
engine: a JSON array of {text, confidence, x, y, width, height} in the pixels of
the image it was given, origin at the top left. Poki already reduced the frame to
points, so those pixels are the screen points the tools take.

    python native/ocr_win.py shot.png
    python native/ocr_win.py --server          # one path per line, one array per line

Two engines are available, and the choice is made by measurement rather than pedigree.
On a 1320x2868 capture, ten runs, same process:

    Windows.Media.OCR                        203 ms, 5 of 7 checked strings
    PP-OCRv6 tiny, onnxruntime on the CPU   1054 ms, 7 of 7
    PP-OCRv6 tiny, onnxruntime on DirectML   202 ms, 7 of 7

DirectML runs the same ONNX graphs on the GPU, which is why the accurate engine is also
the fast one there, and why one engine is enough. It needs the onnxruntime-directml
package; without it the same model still works on the CPU, five times slower.

    POKI_OCR_ENGINE=auto      (default) rapidocr, then Windows.Media.OCR if it cannot load
    POKI_OCR_ENGINE=rapidocr  rapidocr only
    POKI_OCR_ENGINE=windows   Windows.Media.OCR only
"""
import asyncio
import json
import os
import sys

_engines = {}


def windows_engine(path):
    """The WinRT recognizer, which runs on the system's own OCR pipeline."""
    from winsdk.windows.graphics.imaging import BitmapDecoder, BitmapPixelFormat, SoftwareBitmap
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import FileAccessMode, StorageFile

    async def run(path):
        if 'engine' not in _engines:
            _engines['engine'] = OcrEngine.try_create_from_user_profile_languages()
        engine = _engines['engine']
        if engine is None:
            raise RuntimeError('Windows has no OCR engine for the user profile languages; add the language pack or use POKI_OCR_ENGINE=rapidocr')
        file = await StorageFile.get_file_from_path_async(path)
        stream = await file.open_async(FileAccessMode.READ)
        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()
        if bitmap.bitmap_pixel_format != BitmapPixelFormat.BGRA8:
            bitmap = SoftwareBitmap.convert(bitmap, BitmapPixelFormat.BGRA8)
        return await engine.recognize_async(bitmap)

    result = asyncio.run(run(path))
    elements = []
    for line in result.lines:
        words = list(line.words)
        if not words:
            continue
        left = min(word.bounding_rect.x for word in words)
        top = min(word.bounding_rect.y for word in words)
        right = max(word.bounding_rect.x + word.bounding_rect.width for word in words)
        bottom = max(word.bounding_rect.y + word.bounding_rect.height for word in words)
        elements.append({
            'text': line.text,
            'confidence': 1.0,
            'x': float(left), 'y': float(top),
            'width': float(right - left), 'height': float(bottom - top),
        })
    return elements


def directml_available():
    """Whether this onnxruntime build can put the graph on a GPU."""
    try:
        import onnxruntime
        return 'DmlExecutionProvider' in onnxruntime.get_available_providers()
    except Exception:  # noqa: BLE001 - a missing or broken runtime means CPU only
        return False


def rapidocr(path):
    """PP-OCRv6 tiny for accuracy, loaded once per process.

    Defaults are overridden on purpose: rapidocr 3.x defaults to Det.limit_type 'min'
    with 736, which upscales a phone screen that is already in points, and it runs the
    angle classifier on every line. 'max' with 960 only ever shrinks, which is what a
    screenshot wants.
    """
    if 'rapidocr' not in _engines:
        try:
            from rapidocr import ModelType, OCRVersion, RapidOCR
            params = {
                'Global.log_level': 'error',
                'Global.max_side_len': 4000,
                'Global.use_cls': False,
                'Det.ocr_version': OCRVersion('PP-OCRv6'),
                'Det.model_type': ModelType('tiny'),
                'Det.limit_side_len': 960,
                'Det.limit_type': 'max',
                'Rec.ocr_version': OCRVersion('PP-OCRv6'),
                'Rec.model_type': ModelType('tiny'),
            }
            if directml_available():
                params['EngineConfig.onnxruntime.use_dml'] = True
            _engines['rapidocr'] = ('v3', RapidOCR(params=params))
        except ImportError:
            from rapidocr_onnxruntime import RapidOCR
            _engines['rapidocr'] = ('v1', RapidOCR())
    flavour, engine = _engines['rapidocr']
    if flavour == 'v1':
        result, _ = engine(path)
        rows = [(box, text, confidence) for box, text, confidence in (result or [])]
    else:
        output = engine(path)
        # rapidocr 3.x answers with arrays, and an empty result has None in each field;
        # `or []` would raise on a multi-element array, so each field is checked explicitly.
        boxes = getattr(output, 'boxes', None)
        texts = getattr(output, 'txts', None)
        scores = getattr(output, 'scores', None)
        rows = list(zip(list(boxes) if boxes is not None else [],
                        list(texts) if texts is not None else [],
                        list(scores) if scores is not None else []))
    elements = []
    for box, text, confidence in rows:
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        elements.append({
            'text': text,
            'confidence': float(confidence),
            'x': float(min(xs)),
            'y': float(min(ys)),
            'width': float(max(xs) - min(xs)),
            'height': float(max(ys) - min(ys)),
        })
    return elements


ENGINES = {'windows': windows_engine, 'rapidocr': rapidocr}


# An engine that failed to load once is not worth paying for on every frame.
_disabled = set()


def recognize(path):
    choice = os.environ.get('POKI_OCR_ENGINE', 'auto').strip().lower()
    order = [choice] if choice in ENGINES else ['rapidocr', 'windows']
    errors = []
    for name in order:
        if name in _disabled:
            continue
        try:
            return ENGINES[name](path), name
        except Exception as error:  # noqa: BLE001 - try the next engine, report all failures
            errors.append(f'{name}: {error}')
            if 'import' in str(error).lower() or 'no module' in str(error).lower() or 'cannot' in str(error).lower():
                _disabled.add(name)
    raise RuntimeError('; '.join(errors) or f'unknown POKI_OCR_ENGINE {choice!r}')


def serve():
    """One image path per line on stdin, one reply per line on a private channel.

    Replies leave on a duplicate of the original stdout, and descriptor 1 is then pointed
    at stderr, so nothing a library prints can land in the middle of the protocol. Without
    that, one stray line shifts every later reply onto the wrong frame, and the caller taps
    coordinates read from a screen that is no longer there.
    """
    protocol = os.fdopen(os.dup(1), 'w', encoding='utf-8', newline='\n')
    os.dup2(2, 1)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    # Paths arrive from the caller as UTF-8; a pipe on Windows would otherwise decode them
    # with the ANSI code page and miss every file under a non-ASCII user name.
    try:
        sys.stdin.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            elements, _engine = recognize(path)
            reply = {'path': path, 'elements': elements}
        except Exception as error:  # noqa: BLE001 - answer the request, keep serving
            reply = {'path': path, 'error': str(error)}
        try:
            protocol.write(json.dumps(reply, sort_keys=True, ensure_ascii=False) + '\n')
            protocol.flush()
        except OSError:
            break  # the reader is gone; leave quietly instead of raising out of the loop
    return 0


def main(argv):
    if len(argv) == 2 and argv[1] == '--server':
        return serve()
    if len(argv) != 2:
        print('Expected a readable image path', file=sys.stderr)
        return 1
    # The caller reads UTF-8. A Windows console or pipe defaults to the ANSI code page,
    # which cannot represent the labels this prints, so the stream is set explicitly.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    try:
        elements, engine = recognize(argv[1])
    except Exception as error:  # noqa: BLE001 - the caller needs the reason, not a traceback
        print(f'OCR failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(elements, sort_keys=True, ensure_ascii=False))
    print(f'engine={engine}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
