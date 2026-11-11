import test from 'node:test';
import assert from 'node:assert/strict';
import { terminateAppMatch } from '../src/platform.mjs';

const bundle = '/private/var/containers/Bundle/Application/8E2A1C4D-9B0F-4A1E-8C3D-111111111111/Calculator.app';
const calculator = {
  bundle_id: 'com.apple.calculator',
  path: bundle,
};
const runningCalculator = {
  executable: `file://${bundle}/Calculator`,
  processIdentifier: 33654,
};
const calculatorExtension = {
  executable: `file://${bundle}/PlugIns/Widget.appex/Widget`,
  processIdentifier: 33655,
};
const safari = {
  executable: 'file:///private/var/containers/Bundle/Application/OTHER/MobileSafari.app/MobileSafari',
  processIdentifier: 12,
};

test('terminate_app matches a devicectl file URL to the plain app path', () => {
  const matched = terminateAppMatch(calculator, [safari, runningCalculator, calculatorExtension]);
  assert.deepEqual(matched, { processes: [runningCalculator, calculatorExtension] });

  const plainExecutable = { executable: `${bundle}/Calculator`, processIdentifier: 7 };
  assert.deepEqual(terminateAppMatch(calculator, [plainExecutable]), { processes: [plainExecutable] });

  const fileURLApp = { ...calculator, path: `file://${bundle}` };
  assert.deepEqual(terminateAppMatch(fileURLApp, [runningCalculator]), { processes: [runningCalculator] });

  const spaced = {
    bundle_id: 'local.myapp',
    path: '/private/var/containers/Bundle/Application/UUID/My App.app',
  };
  const encoded = {
    executable: 'file:///private/var/containers/Bundle/Application/UUID/My%20App.app/My%20App',
    processIdentifier: 3,
  };
  assert.deepEqual(terminateAppMatch(spaced, [encoded, safari]), { processes: [encoded] });
});

test('terminate_app returns already_stopped only when that app is not running', () => {
  assert.deepEqual(terminateAppMatch(calculator, [safari]), {
    bundle_id: 'com.apple.calculator',
    already_stopped: true,
  });
  assert.deepEqual(terminateAppMatch(calculator, []), {
    bundle_id: 'com.apple.calculator',
    already_stopped: true,
  });
  assert.equal(terminateAppMatch(calculator, [runningCalculator]).already_stopped, undefined);
});
