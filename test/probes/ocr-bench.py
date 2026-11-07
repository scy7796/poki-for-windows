"""Compare OCR configurations on the same images, the way Poki uses them.

Poki recognizes every frame it observes, so what matters is the cost of one frame in a
process that is already warm, not the cost of a cold start. Each configuration therefore
runs one discarded warm-up call and then N measured calls in the same process.

    python test/probes/ocr-bench.py IMAGE... --runs 10

Reports first call, median and p90 in milliseconds, plus the text found so two
configurations can be compared on accuracy as well as speed.
"""
import argparse
import json
import statistics
import sys
import time


def load_windows():
    from winsdk.windows.graphics.imaging import BitmapDecoder, BitmapPixelFormat, SoftwareBitmap
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import FileAccessMode, StorageFile
    import asyncio

    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError('no Windows OCR engine for the profile languages')

    def run(path):
        async def once():
            file = await StorageFile.get_file_from_path_async(path)
            stream = await file.open_async(FileAccessMode.READ)
            decoder = await BitmapDecoder.create_async(stream)
            bitmap = await decoder.get_software_bitmap_async()
            if bitmap.bitmap_pixel_format != BitmapPixelFormat.BGRA8:
                bitmap = SoftwareBitmap.convert(bitmap, BitmapPixelFormat.BGRA8)
            return await engine.recognize_async(bitmap)
        result = asyncio.run(once())
        return [line.text for line in result.lines]

    return run


def load_rapidocr_old():
    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR()

    def run(path):
        result, _ = engine(path)
        return [text for _box, text, _score in (result or [])]

    return run


def load_rapidocr3(version, model_type, engine_type, limit_side=736, limit_type='min', cls=True, dml=False):
    """One rapidocr 3.x engine.

    Det.limit_type decides what happens to an image that is already the right size:
    'min' grows a short side up to limit_side (so a 440x956 frame is upscaled to
    736x1600), while 'max' only ever shrinks. The default is 'min' with 736, which is a
    poor fit for a phone screen that is already in points.
    """
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR
    backend = {'onnxruntime': EngineType.ONNXRUNTIME, 'openvino': EngineType.OPENVINO}[engine_type]
    params = {
        'Global.log_level': 'error',
        'Global.max_side_len': 4000,
        'Global.use_cls': cls,
        'EngineConfig.engine_type': backend,
        'Det.ocr_version': OCRVersion(version),
        'Det.model_type': ModelType(model_type),
        'Det.limit_side_len': limit_side,
        'Det.limit_type': limit_type,
        'Rec.ocr_version': OCRVersion(version),
        'Rec.model_type': ModelType(model_type),
    }
    if dml:
        params['EngineConfig.onnxruntime.use_dml'] = True
    engine = RapidOCR(params=params)

    def run(path):
        result = engine(path)
        texts = getattr(result, 'txts', None)
        if texts is None and isinstance(result, tuple):
            texts = [text for _box, text, _score in (result[0] or [])]
        return list(texts or [])

    return run


CONFIGS = {
    'windows': load_windows,
    'rapidocr1-v4': load_rapidocr_old,
    'v6-tiny-onnx': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime'),
    'v6-small-onnx': lambda: load_rapidocr3('PP-OCRv6', 'small', 'onnxruntime'),
    'v6-tiny-ov': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'openvino'),
    'v6-small-ov': lambda: load_rapidocr3('PP-OCRv6', 'small', 'openvino'),
    'v5-mobile-onnx': lambda: load_rapidocr3('PP-OCRv5', 'mobile', 'onnxruntime'),
    'v5-mobile-ov': lambda: load_rapidocr3('PP-OCRv5', 'mobile', 'openvino'),
    # No upscaling, no angle classifier: the shape a screen frame actually wants.
    'v6-tiny-960': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 960, 'max', False),
    'v6-small-960': lambda: load_rapidocr3('PP-OCRv6', 'small', 'onnxruntime', 960, 'max', False),
    'v6-tiny-960-ov': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'openvino', 960, 'max', False),
    'v6-small-960-ov': lambda: load_rapidocr3('PP-OCRv6', 'small', 'openvino', 960, 'max', False),
    # Accuracy-oriented: keep more of the original 3x capture.
    'v6-small-1600': lambda: load_rapidocr3('PP-OCRv6', 'small', 'onnxruntime', 1600, 'max', False),
    'v6-small-1600-ov': lambda: load_rapidocr3('PP-OCRv6', 'small', 'openvino', 1600, 'max', False),
    # Detection resolution is the knob that trades time for detail: everything is cropped
    # for recognition out of the image detection ran on, so a smaller limit also blurs the
    # characters the recognizer sees.
    'v6-tiny-736': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 736, 'max', False),
    'v6-tiny-1280': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 1280, 'max', False),
    'v6-tiny-1600': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 1600, 'max', False),
    'v6-tiny-2000': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 2000, 'max', False),
    # DirectML runs the same ONNX graphs on the GPU. It needs onnxruntime-directml.
    'v6-tiny-960-dml': lambda: load_rapidocr3('PP-OCRv6', 'tiny', 'onnxruntime', 960, 'max', False, True),
    'v6-small-960-dml': lambda: load_rapidocr3('PP-OCRv6', 'small', 'onnxruntime', 960, 'max', False, True),
}


def measure(run, path, runs):
    started = time.perf_counter()
    texts = run(path)
    first = (time.perf_counter() - started) * 1000
    samples = []
    for _ in range(runs):
        started = time.perf_counter()
        run(path)
        samples.append((time.perf_counter() - started) * 1000)
    samples.sort()
    p90 = samples[min(len(samples) - 1, int(round(0.9 * (len(samples) - 1))))]
    return {
        'first_ms': round(first),
        'median_ms': round(statistics.median(samples)),
        'p90_ms': round(p90),
        'min_ms': round(samples[0]),
        'lines': len(texts),
        'texts': texts,
    }


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('images', nargs='+')
    parser.add_argument('--runs', type=int, default=10)
    parser.add_argument('--only', default='')
    parser.add_argument('--texts', default='')
    args = parser.parse_args(argv[1:])
    wanted = [name for name in CONFIGS if not args.only or name in args.only.split(',')]
    collected = {}
    for path in args.images:
        for name in wanted:
            try:
                run = CONFIGS[name]()
            except Exception as error:  # noqa: BLE001 - report and keep going
                print(f'{path}\t{name}\tunavailable\t{str(error)[:120]}')
                continue
            result = measure(run, path, args.runs)
            collected[f'{path}|{name}'] = result
            print(f"{path}\t{name}\tfirst {result['first_ms']}\tmedian {result['median_ms']}\tp90 {result['p90_ms']}\tmin {result['min_ms']}\tlines {result['lines']}")
    if args.texts:
        with open(args.texts, 'w', encoding='utf-8') as handle:
            json.dump(collected, handle, ensure_ascii=False, indent=1)
        print(f'texts written to {args.texts}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
