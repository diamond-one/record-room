import test from 'node:test';
import assert from 'node:assert/strict';
import { rampRate, rampDistance, scheduleRate } from '../varispeed.js';

test('the rate integral matches acceleration, constant speed and braking to near-zero', () => {
  const rising = { at: 10, from: 1, target: 2, duration: 2 };
  assert.equal(rampRate(rising, 10), 1);
  assert.equal(rampRate(rising, 11), 1.5);
  assert.equal(rampRate(rising, 13), 2);
  assert.equal(rampDistance(rising, 9), 0);
  assert.equal(rampDistance(rising, 11), 1.25);
  assert.equal(rampDistance(rising, 13), 5);
  const brake = { at: 0, from: 1, target: 0.0001, duration: 1 };
  assert.equal(rampRate(brake, 1), 0.0001);
  assert.equal(rampDistance(brake, 1), 0.50005);
  assert.equal(rampDistance({ at: 5, from: 2, target: 0.5, duration: 0 }, 7), 1);
});

test('retarget scheduling supports browsers without cancelAndHoldAtTime and never uses abrupt .value writes', () => {
  const calls = [];
  const param = {
    cancelScheduledValues: (...args) => calls.push(['cancel', ...args]),
    setValueAtTime: (...args) => calls.push(['set', ...args]),
    linearRampToValueAtTime: (...args) => calls.push(['ramp', ...args]),
  };
  scheduleRate(param, 1.04, 0.92, 5, 0.2);
  assert.deepEqual(calls, [['cancel', 5], ['set', 1.04, 5], ['ramp', 0.92, 5.2]]);
});
