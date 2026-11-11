import assert from 'node:assert/strict';
import test from 'node:test';
import { channelOf } from '../src/install/setup-app.mjs';

test('app-* tags map to channels', () => {
  assert.equal(channelOf('app-0.2.9-prealpha.640', true), 'pre-alpha');
  assert.equal(channelOf('app-prealpha-latest', true), 'pre-alpha');
  assert.equal(channelOf('app-0.2.9-alpha.640', true), 'alpha');
  assert.equal(channelOf('app-alpha-latest', true), 'alpha');
  assert.equal(channelOf('app-0.3.0-beta.1', true), 'beta');
  assert.equal(channelOf('app-0.3.0', false), 'stable');
  assert.equal(channelOf('app-0.3.0', true), 'beta');
  assert.equal(channelOf('app-latest', false), null);
});

test('ios-* and desktop-* tags keep their channels', () => {
  assert.equal(channelOf('ios-prealpha-latest', true), 'pre-alpha');
  assert.equal(channelOf('ios-alpha-0.2.8-501', true), 'alpha');
  assert.equal(channelOf('ios-beta-0.2.9-520', true), 'beta');
  assert.equal(channelOf('ios-v0.3.0-beta.1', true), 'beta');
  assert.equal(channelOf('desktop-v0.3.0', false), 'stable');
  assert.equal(channelOf('v0.1.1', false), null);
});
