import test from 'node:test';
import assert from 'node:assert/strict';
import { learnReadout, readCurrent } from '../readout.mjs';

test('A learned fixed field reads the new value and refuses missing or ambiguous fields', () => {
  const screen = { elements: [
    { ref: 'e124', role: 'StaticText', label: '电池健康', trait_names: ['Header'] },
    { ref: 'e127', role: 'StaticText', label: '最大容量、90%', trait_names: [] },
  ] };
  const readout = learnReadout({ kind: 'field', items: [{ ref: 'e127', field: 'label', prefix: '最大容量、', suffix: '%' }] }, screen);
  assert.deepEqual(readCurrent(readout, screen).details, [{ label: '最大容量', value: '90%' }]);
  const updated = { elements: [screen.elements[0], { ...screen.elements[1], ref: 'e200', label: '最大容量、89%' }] };
  assert.deepEqual(readCurrent(readout, updated).details, [{ label: '最大容量', value: '89%' }]);
  assert.equal(readCurrent(readout, { elements: [updated.elements[0]] }), null);
  assert.equal(readCurrent(readout, { elements: [...updated.elements, { ...updated.elements[1], ref: 'e201' }] }), null);
  const separate = { elements: [{ ref: 'e1', role: 'TextField', label: 'Capacity', value: '90%' }] };
  const valueReadout = learnReadout({ kind: 'field', items: [{ ref: 'e1', field: 'value' }] }, separate);
  assert.equal(readCurrent(valueReadout, { elements: [{ ...separate.elements[0], value: '' }] }), null);
  assert.equal(readCurrent(valueReadout, { elements: [{ ...separate.elements[0], value: '89%' }] }).details[0].value, '89%');
});

test('A learned list never reads a hidden row, whether its visible flag is false or 0', () => {
  const start = { ref: 'e1', role: 'Heading', label: 'Events', visible: 1, enabled: 1 };
  const row = { ref: 'e2', role: 'StaticText', label: '09:00 Synthetic event' };
  const end = { ref: 'e3', role: 'Heading', label: 'End', visible: 1, enabled: 1 };
  const readout = learnReadout({ kind: 'list', start_ref: 'e1', end_ref: 'e3', items: [{ ref: 'e2', field: 'label' }] }, { elements: [start, row, end] });
  const read = flags => readCurrent(readout, { elements: [start, { ...row, ...flags }, end] });
  assert.deepEqual(read({}).details, [{ label: 'Events', value: '09:00 Synthetic event' }], 'A row without flags is still read');
  for (const off of [false, 0]) {
    assert.equal(read({ visible: off, enabled: 1 }), null, `visible: ${off} must not become a verified answer`);
    assert.equal(read({ visible: 1, enabled: off }), null, `enabled: ${off} must not become a verified answer`);
  }
});
