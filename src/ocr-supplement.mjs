import { flagOn } from './element-flags.mjs';

// An app can draw a list with its own renderer and publish no elements for it, so accessibility names
// a header and nothing below it. When a third of the screen's height holds no named element, the
// screenshot's text that accessibility did not name is added.
const box = element => element.frame ?? element;
const named = element => [element.label, element.text, element.value].some(value => typeof value === 'string' && value.trim());

// Named, visible elements smaller than half the screen: a labelled container that spans the screen
// says nothing about what is drawn inside it.
function namedFrames(elements, { width, height }) {
  return elements
    .filter(element => flagOn(element.visible) && named(element) && (element.type ?? element.role) !== 'Application')
    .map(box)
    .filter(frame => frame.width * frame.height < width * height / 2);
}

export function leavesUnnamedBand(elements, size) {
  const spans = namedFrames(elements, size)
    .map(frame => [Math.max(0, frame.y), Math.min(size.height, frame.y + frame.height)])
    .filter(([top, bottom]) => bottom > top)
    .sort((a, b) => a[0] - b[0]);
  let reached = 0, widest = 0;
  for (const [top, bottom] of spans) { widest = Math.max(widest, top - reached); reached = Math.max(reached, bottom); }
  return Math.max(widest, size.height - reached) >= size.height / 3;
}

// Recognized text whose centre is not inside an element accessibility already named.
export function textOutside(recognized, elements, size) {
  const frames = namedFrames(elements, size);
  return recognized.filter(text => {
    const f = box(text), x = f.x + f.width / 2, y = f.y + f.height / 2;
    return !frames.some(n => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height);
  }).map(text => ({ ...text, source: 'ocr' }));
}
