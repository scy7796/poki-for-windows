"""Compare recognizer output against strings that are visibly on the screenshot.

Ground truth was read off the image by eye (crop-top.png / crop-mid.png): the status bar
time, the WeChat title with its unread count, and the search field placeholder. Those are
the strings a caller actually asks Poki to tap, so getting them right is what matters.

    python test/probes/ocr-accuracy.py result.json IMAGE
"""
import json
import re
import sys
import unicodedata

CJK = '\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff'
SQUEEZE = re.compile(f'(?<=[{CJK}])[ \\t]+|[ \\t]+(?=[{CJK}])')

GROUND_TRUTH = {
    '4:57': 'status bar time',
    '微信（714）': 'WeChat title with unread count',
    '搜索': 'search field placeholder',
    '公众号': 'official accounts row',
    '江西财经大学': 'preview line under that row',
    '鲍林正分子营养交流': 'group chat row with less common characters',
    '下午 4:56': 'timestamp on the right of a row',
}
# How each engine spelled the same three things, for the record.
TOLERANT = {
    '4:57': [r'4\s*[:：]\s*57', r'4\D{0,3}57'],
    '微信（714）': [r'微信', r'714'],
    '搜索': [r'搜索'],
}


def squeeze(text):
    # NFKC folds full-width punctuation to ASCII, the same as the runtime's normalize().
    return SQUEEZE.sub('', unicodedata.normalize('NFKC', text))


def score(texts, key):
    joined = '\n'.join(texts)
    tight = squeeze(joined)
    if squeeze(key) in tight:
        return 2  # exact, ignoring spaces a recognizer may insert between characters
    patterns = TOLERANT.get(key, [])
    if any(re.search(pattern, joined) or re.search(pattern, tight) for pattern in patterns):
        return 1  # partially present
    return 0


def main(argv):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    path, image = argv[1], argv[2]
    data = json.load(open(path, encoding='utf-8'))
    for composite, result in sorted(data.items()):
        name, config = composite.split('|')
        if name != image:
            continue
        texts = result['texts']
        scores = {key: score(texts, key) for key in GROUND_TRUTH}
        exact = sum(1 for value in scores.values() if value == 2)
        partial = sum(1 for value in scores.values() if value == 1)
        print(f"{config:20} median {result['median_ms']:5} ms  lines {result['lines']:3}  "
              f"exact {exact}/{len(GROUND_TRUTH)}  partial {partial}/{len(GROUND_TRUTH)}")
        for key, value in scores.items():
            mark = {2: 'ok  ', 1: 'part', 0: 'MISS'}[value]
            print(f"    {mark} {key}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
