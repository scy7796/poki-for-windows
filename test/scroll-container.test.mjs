import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Devices } from '../src/device.mjs';
import { whatMoved } from '../src/interaction.mjs';

// A page invented for these tests: a header, two buttons and a sideways row of chips ("Recent")
// that pages under a drag. Drawn as blocks, so pixels change exactly when the screen does.
const W = 200, H = 400, app = { pid: 501, bundle_id: 'local.rows' };
const el = (role, label, x, y, width, height) => ({ role, type: role, label, x, y, width, height });

class RowPhone extends Devices {
  offset = 0; drags = [];
  constructor() { super(); this.size = { device: 'phone-1', width: W, height: H }; }
  screen() {
    return { foreground: app, elements: [el('StaticText', 'Accounts', 10, 40, 100, 20), el('Button', 'Entries', 10, 100, 180, 40), el('Button', 'Settings', 10, 150, 180, 40),
      el('CollectionView', 'Recent', 0, 200, 200, 60), ...[1, 2, 3, 4, 5, 6].map(n => el('Cell', `Chip ${n}`, 10 + (n - 1) * 70 + this.offset, 210, 60, 40)).filter(e => e.x < W && e.x + e.width > 0)] };
  }
  async inventory() { return [{ id: 'phone-1', kind: 'physical', name: 'Test Phone', state: 'Booted' }]; }
  async bridge(request) {
    if (request.op === 'ax') return this.screen();
    if (request.op === 'drag') {
      this.drags.push(request);
      const [x1, y1, x2] = [request.x1 / 65535 * (W - 1), request.y1 / 65535 * (H - 1), request.x2 / 65535 * (W - 1)];
      if (y1 >= 200 && y1 <= 260) this.offset = Math.max(-280, Math.min(0, this.offset + Math.round(x2 - x1)));
    }
    return { sent: true, screen_change_verified: false };
  }
  async captureFrame() {
    const blocks = await Promise.all(this.screen().elements.map(async e => ({ input: await sharp({ create: { width: Math.max(4, Math.min(e.width, W - Math.max(0, e.x))), height: e.height, channels: 3, background: { r: e.label.length * 9 % 200, g: 90, b: 90 } } }).png().toBuffer(), left: Math.max(0, e.x), top: e.y })));
    const data = await sharp({ create: { width: W, height: H, channels: 3, background: 'white' } }).composite(blocks).png().toBuffer();
    const now = new Date().toISOString();
    this.frame = { id: String(Math.random()), device: 'phone-1', revision: this.coordinator.revision('phone-1'), width: W, height: H, scale: 1, data, original: data, at: Date.now(), capture_started_at: now, capture_completed_at: now };
    return this.frame;
  }
}
const body = result => JSON.parse(result.content.find(block => block.type === 'text').text);

test('a one-page scroll inside a named row moves only that row, without coasting, and says which container moved', { timeout: 30000 }, async () => {
  const phone = new RowPhone();
  const single = body(await phone.call('scroll', { direction: 'right', container: 'Recent', pages: 1 }));
  const drag = phone.drags.at(-1);
  assert.ok(drag.end_hold_ms > 0, 'held before lifting, so the row does not coast');
  const y = drag.y1 / 65535 * (H - 1);
  assert.ok(y >= 200 && y <= 260, `dragged inside the row, at y ${y}`);
  assert.ok(drag.x1 > drag.x2, 'the finger moves left to reveal what is to the right');
  assert.equal(single.moved?.container, 'Recent', JSON.stringify(single));
  assert.ok(single.moved.shift.x < -100 && single.moved.shift.y === 0, JSON.stringify(single.moved));
  const found = body(await phone.call('scroll_to', { text: 'Chip 6', direction: 'right', container: 'Recent' }));
  assert.equal(found.found, true, JSON.stringify(found));
  assert.ok(phone.drags.at(-1).end_hold_ms > 0, 'scroll_to pages sideways lists');
});

test('whatMoved names the container whose items shifted together', () => {
  const row = el('CollectionView', 'Media Types', 0, 300, 390, 120);
  const before = [row, el('StaticText', 'Header', 10, 40, 100, 20), el('Cell', 'Videos', 10, 310, 100, 100), el('Cell', 'Selfies', 120, 310, 100, 100), el('Cell', 'Live', 230, 310, 100, 100)];
  const after = [row, el('StaticText', 'Header', 10, 40, 100, 20), el('Cell', 'Selfies', 10, 310, 100, 100), el('Cell', 'Live', 120, 310, 100, 100), el('Cell', 'Portrait', 230, 310, 100, 100)];
  assert.deepEqual(whatMoved(before, after), { container: 'Media Types', frame: [0, 300, 390, 120], shift: { x: -110, y: 0 }, items_moved: 2, appeared: 1 });
  assert.equal(whatMoved(before, before), null);
});
