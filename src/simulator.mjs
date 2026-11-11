import { execute, pause } from './work.mjs';
import { join } from 'node:path';
import { root } from './config.mjs';
import { selectKeyboard, sendInput } from './simulator-input.mjs';

const strokeGapMs = 80;
const orientations = new Map();
const screens = new Map();
const roles = ['Unknown', 'Application', 'Button', 'CheckBox', 'GenericElement', 'Group', 'Heading', 'Image', 'Link', 'RadioButton', 'ScrollArea', 'ScrollBar', 'TabGroup', 'Slider', 'StaticText', 'TextField', 'WebArea', 'TextArea', 'Splitter', 'PopUpButton', 'Sheet', 'Grid'];
function invoke(id, request) {
  if (request.op === 'hid') {
    const duration = request.events.reduce((sum, event) => {
      const delay = event.delay_ms ?? 0;
      if (!Number.isFinite(delay) || delay < 0 || delay > 60000) throw new Error('Simulator HID delay must be between 0 and 60000 ms.');
      return sum + delay;
    }, 0);
    if (duration > 70000) throw new Error('A simulator HID batch cannot exceed 70000 ms.');
    return sendInput(id, request.events, Math.ceil(duration) + 15000);
  }
  return execute(join(root, 'build/simulator'), [], { timeout: 60000, maxBuffer: 16 * 1024 * 1024, input: JSON.stringify({ id, ...request }) }).then(({ stdout }) => JSON.parse(stdout));
}

const keys = {
  return: 40, escape: 41, delete: 42, backspace: 42, tab: 43, space: 44,
  home: 74, page_up: 75, forward_delete: 76, end: 77, page_down: 78,
  right: 79, left: 80, down: 81, up: 82,
};
for (let index = 0; index < 26; index++) keys[String.fromCharCode(97 + index)] = 4 + index;
for (let index = 1; index <= 9; index++) keys[String(index)] = 29 + index;
keys['0'] = 39;
const modifiers = { control: 224, shift: 225, option: 226, command: 227 };
const buttons = { home: 0x40, lock: 0x30, power: 0x30, siri: 0xcf, volume_up: 0xe9, volume_down: 0xea, 'volume-up': 0xe9, 'volume-down': 0xea, mute: 0xe2, keyboard: 0xb8 };
const keyEvent = (code, down) => ({ messageType: 'IndigoKeyboardButtonEvent', payload: { usageCode: code, state: down ? 1 : 2 } });
const plainCharacters = "1234567890-=[]\\;'`,./";
const shiftedCharacters = '!@#$%^&*()_+{}|:"~<>?';
const characterCodes = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56];
function textKey(character) {
  if (/^[a-z]$/i.test(character)) return { code: keys[character.toLowerCase()], shift: character !== character.toLowerCase() };
  const plain = plainCharacters.indexOf(character), shifted = shiftedCharacters.indexOf(character);
  if (plain >= 0) return { code: characterCodes[plain], shift: false };
  if (shifted >= 0) return { code: characterCodes[shifted], shift: true };
  return { code: { ' ': 44, '\n': 40, '\r': 40, '\t': 43 }[character], shift: false };
}
// About the pace of a fast typist. Typing stayed exact down to 3 ms in testing, and fill verifies the result.
const keyDelay = 30;
function keyStroke(code, held = []) {
  return [...held.map(value => keyEvent(value, true)), ...(held.length ? [{ delay_ms: keyDelay }] : []), keyEvent(code, true), { delay_ms: keyDelay }, keyEvent(code, false), { delay_ms: keyDelay }, ...held.toReversed().map(value => keyEvent(value, false)), ...(held.length ? [{ delay_ms: keyDelay }] : [])];
}
function* keyboardStrokes(request) {
  if (request.op === 'type_text') {
    if (request.clear) for (let repeat = 0; repeat < 2; repeat++) { yield keyStroke(keys.a, [modifiers.command]); yield keyStroke(keys.backspace); }
    for (const character of request.text ?? '') { const { code, shift } = textKey(character); yield keyStroke(code, shift ? [modifiers.shift] : []); }
    return;
  }
  const key = keys[request.key];
  if (key === undefined) throw new Error(`Unknown key: ${request.key}`);
  const held = (request.modifiers ?? []).map(name => { if (!(name in modifiers)) throw new Error(`Unknown modifier: ${name}`); return modifiers[name]; });
  for (let count = 0; count < (request.count ?? 1); count++) yield keyStroke(key, held);
}
async function sendKeyboard(id, request) {
  let events = [], duration = 0, batches = 0, sentEvents = 0;
  const flush = async () => {
    if (!events.length) return;
    await invoke(id, { op: 'hid', events });
    sentEvents += events.length; batches++; events = []; duration = 0;
  };
  try {
    for (const stroke of keyboardStrokes(request)) {
      const elapsed = stroke.reduce((sum, event) => sum + (event.delay_ms ?? 0), 0);
      // A boundary always follows key-up and modifier-up. Each batch is bounded
      // in both work and time, independent of the total input string length.
      if (events.length + stroke.length > 5000 || duration + elapsed > 30000) await flush();
      events.push(...stroke); duration += elapsed;
    }
    await flush();
  } catch (error) { throw new Error(`Simulator keyboard stopped after ${batches} complete batches: ${error.message}`); }
  return { sent: true, screen_change_verified: false, events: sentEvents, batches };
}
const focusedField = tree => tree.elements.find(element => element.focused && ['TextField', 'TextArea'].includes(element.type));
const isEmptyField = field => Boolean(field) && (!field.value || field.value === field.placeholder);
// SpringBoard in front means a system prompt took the input. handle_alert can answer it.
const systemPrompt = (result, labels) => ({ ...result, isError: true, stop_reason: 'error', reason: 'system_prompt', prompt_text: labels, text_verified: false, submit_sent: false, instruction: 'A system prompt is on screen, so the text was not confirmed and nothing was submitted. Answer it with handle_alert, read the field, then retry if the text is missing.' });
async function pasteText(id, request) {
  const result = await invoke(id, { ...request, op: 'paste_text', submit: false });
  const after = await simulatorRequest(id, { op: 'ax' });
  const labels = after.elements.map(element => element.label).filter(Boolean);
  if (after.foreground.bundle_id === 'com.apple.springboard') return systemPrompt(result, labels);
  const field = focusedField(after);
  const verified = field && (request.clear ? field.value === request.text : field.value?.includes(request.text));
  if (request.submit && verified) await simulatorRequest(id, { op: 'key', key: 'return' });
  return { ...result, text_verified: Boolean(verified), ...(field ? { field_value: field.value } : {}), ...(request.submit && !verified ? { submit_sent: false, instruction: 'Inspect the field before submitting; the paste result was not verified.' } : {}) };
}

export async function simulatorRequest(id, request) {
  const { op } = request;
  if (op === 'info') {
    const info = screens.get(id) ?? await invoke(id, { op });
    screens.set(id, info);
    if (orientations.get(id)?.startsWith('landscape')) return { ...info, width: info.height, height: info.width, orientation: orientations.get(id) };
    return { ...info, orientation: orientations.get(id) ?? 'portrait' };
  }
  if (op === 'ax') {
    const value = await invoke(id, { op });
    return { source: 'accessibility', foreground: { bundle_id: value.bundle_id, name: value.label, pid: value.pid },
      elements: value.elements.map(element => ({ ...element, type: element.subrole === 5 ? 'SecureTextField' : roles[element.type] ?? `AXRole${element.type}`, frame: { x: element.x, y: element.y, width: element.width, height: element.height } })) };
  }
  if (op === 'clipboard') return invoke(id, { op });
  if (op === 'type_text' && /[^\x09\x0a\x0d\x20-\x7e]/.test(request.text)) {
    return pasteText(id, request);
  }
  if (op === 'rotate') {
    const result = await invoke(id, request);
    orientations.set(id, request.orientation);
    return result;
  }
  const events = [];
  const isKeyboard = op === 'type_text' || op === 'key';
  if (op === 'button') {
    const usage = buttons[request.button];
    if (usage === undefined) throw new Error(`Unknown button: ${request.button}`);
    const payload = { usagePage: 12, usageCode: usage };
    events.push({ messageType: 'IndigoButtonEvent', payload: { ...payload, state: 1 } }, { delay_ms: 60 }, { messageType: 'IndigoButtonEvent', payload: { ...payload, state: 2 } });
  } else if (!isKeyboard) {
    const geometry = await simulatorRequest(id, { op: 'info' });
    const point = (x, y) => {
      if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > geometry.width || y > geometry.height) throw new Error(`Simulator point is outside ${geometry.width} × ${geometry.height}.`);
      return { x: x / geometry.width, y: y / geometry.height };
    };
    const touch = (first, type, second) => ({ messageType: 'IndigoDigitizerEvent', payload: { pointOne: first, ...(second ? { pointTwo: second } : {}), eventType: type, edge: 0, target: 0 } });
    if (['tap', 'double_tap', 'long_press'].includes(op)) {
      const location = point(request.x, request.y);
      for (let tap = 0; tap < (op === 'double_tap' ? 2 : 1); tap++) {
        events.push(touch(location, 0), { delay_ms: op === 'long_press' ? request.duration_ms ?? 1000 : 40 }, touch(location, 2));
        if (op === 'double_tap' && tap === 0) events.push({ delay_ms: 80 });
      }
    } else if (op === 'drag') {
      const from = point(request.x1, request.y1), to = point(request.x2, request.y2);
      const duration = request.duration_ms ?? 300;
      const steps = Math.min(2000, Math.max(2, Math.ceil(duration / 16)));
      events.push(touch(from, 0), { delay_ms: request.hold_ms ?? 0 });
      for (let step = 1; step <= steps; step++) events.push({ delay_ms: duration / steps }, touch({ x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }, 1));
      events.push({ delay_ms: request.end_hold_ms ?? 0 }, touch(to, 2));
    } else if (op === 'draw_strokes') {
      // The helper lifts a touch that is still down when its batch ends, so each stroke is one batch.
      const batches = request.strokes.map((points, stroke) => [
        ...points.map((p, index) => ({ ...touch(point(p.x, p.y), index ? 1 : 0), ...(index ? { delay_ms: p.time_ms - points[index - 1].time_ms } : stroke ? { delay_ms: strokeGapMs } : {}) })),
        touch(point(points.at(-1).x, points.at(-1).y), 2),
      ]);
      for (const events of batches) await invoke(id, { op: 'hid', events });
      return { sent: true, screen_change_verified: false, strokes: batches.length };
    } else if (op === 'pinch') {
      const duration = request.duration_ms ?? 500;
      const steps = Math.min(2000, Math.max(2, Math.ceil(duration / 16)));
      const pair = distance => [point(request.x - distance / 2, request.y), point(request.x + distance / 2, request.y)];
      const begin = pair(request.start_distance), end = pair(request.end_distance);
      events.push(touch(begin[0], 0, begin[1]));
      for (let step = 1; step <= steps; step++) {
        const current = pair(request.start_distance + (request.end_distance - request.start_distance) * step / steps);
        events.push({ delay_ms: duration / steps }, touch(current[0], 1, current[1]));
      }
      events.push(touch(end[0], 2, end[1]));
    } else throw new Error(`Unknown simulator operation: ${op}`);
  }
  if (op === 'type_text' && request.text) await selectKeyboard(id);
  // Backspace in an empty field can delete what holds it, such as a new reminder row.
  const emptyFocused = op === 'type_text' && request.clear && isEmptyField(focusedField(await simulatorRequest(id, { op: 'ax' })));
  const result = isKeyboard ? await sendKeyboard(id, emptyFocused ? { ...request, clear: false } : request) : await invoke(id, { op: 'hid', events });
  if (op === 'button' && request.button === 'home') {
    const deadline = Date.now() + 5000;
    let observed, lastError;
    while (Date.now() < deadline) {
      try {
        observed = (await simulatorRequest(id, { op: 'ax' })).foreground;
        if (observed.bundle_id === 'com.apple.springboard') return { ...result, foreground_verified: true, foreground: observed };
      } catch (error) { lastError = error.message; }
      await pause(100);
    }
    throw new Error(`Home input was sent but SpringBoard did not become the accessibility foreground: ${observed?.bundle_id ?? lastError ?? 'unknown'}.`);
  }
  if (op === 'type_text') {
    const after = await simulatorRequest(id, { op: 'ax' });
    if (after.foreground.bundle_id === 'com.apple.springboard') return systemPrompt(result, after.elements.map(element => element.label).filter(Boolean));
    const field = focusedField(after);
    // A hardware key is interpreted by the active IME. If it changes the text,
    // replace through pasteboard and report any iOS permission prompt.
    if (request.clear && field && field.value !== request.text && !(request.text === '' && field.value === field.placeholder)) return { ...await pasteText(id, request), input_method: 'pasteboard_after_hid_mismatch' };
    if (request.submit && field) await simulatorRequest(id, { op: 'key', key: 'return' });
    return { ...result, text_verified: request.clear && Boolean(field) && (field.value === request.text || (request.text === '' && field.value === field.placeholder)), ...(field ? { field_value: field.value } : {}) };
  }
  return result;
}
