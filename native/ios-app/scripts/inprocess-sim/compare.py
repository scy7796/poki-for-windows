"""compare.py IN_PROCESS.xml REFERENCE(.json from build/simulator op=ax | .xml WDA source) [DX DY]
DX DY: the viewport origin, added to the in-process frames (relative to the front app's part of the screen).
Every labelled reference element must appear in the in-process tree with the same label and a frame within 1 point."""
import json, sys, xml.etree.ElementTree as ET
def from_xml(path):
    out = []
    for e in ET.parse(path).iter():
        a = e.attrib
        if 'x' in a: out.append((a.get('label') or a.get('name') or '', *(float(a[k]) for k in ('x', 'y', 'width', 'height')), a.get('type', e.tag)))
    return out
def from_ax(path):
    return [(e.get('label') or '', e['x'], e['y'], e['width'], e['height'], e.get('type')) for e in json.load(open(path))['elements']]
mine = from_xml(sys.argv[1])
dx, dy = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.0, 0.0)
mine = [(m[0], m[1] + dx, m[2] + dy, m[3], m[4], m[5]) for m in mine]
ref = from_ax(sys.argv[2]) if sys.argv[2].endswith('.json') else from_xml(sys.argv[2])
missing = []
for label, x, y, w, h, kind in ref:
    if not label: continue
    if not any(m[0] == label and all(abs(a - b) <= 1 for a, b in zip(m[1:5], (x, y, w, h))) for m in mine):
        missing.append((label, round(x), round(y), round(w), round(h), kind))
labelled = sum(1 for r in ref if r[0])
print(json.dumps({'in_process_elements': len(mine), 'reference_elements': len(ref), 'reference_labelled': labelled,
                  'matched': labelled - len(missing), 'missing': missing}, ensure_ascii=False, indent=1))
sys.exit(1 if missing else 0)
