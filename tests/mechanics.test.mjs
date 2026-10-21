import test from 'node:test';
import assert from 'node:assert/strict';
import { GROOVES } from '../presentation.js';
import { needleAngle, needleTip, advancePlatter, TURNTABLE } from '../mechanics.js';

const center = TURNTABLE.center;
const outer = TURNTABLE.radius * 2 * GROOVES.outer, inner = TURNTABLE.radius * 2 * GROOVES.inner;
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('platter rotation follows 33 1/3 rpm, 45 rpm, pitch and stopping', () => {
  close(advancePlatter(0,.45,1),90);
  close(advancePlatter(0,1/3,1.35),90);
  close(advancePlatter(0,.45,1.08),97.2);
  close(advancePlatter(123,.65,0),123);
  close(advancePlatter(350,.1,1),10);
});

test('the stylus reaches the actual outer, quarter, middle, three-quarter and inner grooves', () => {
  for (const progress of [0, .25, .5, .75, 1]) {
    const point = needleTip(progress);
    const radius = Math.hypot(point.x - center.x, point.y - center.y);
    close(radius, outer + (inner - outer) * progress);
    assert.ok(point.x >= 0 && point.x <= 1);
    assert.ok(point.y >= 0 && point.y <= 1 / TURNTABLE.aspect);
    assert.ok(point.x > center.x - .05 && point.y > center.y, 'the inward branch stays on the reachable lower record arc');
  }
});

test('the photographed stylus and moving counterweight use the real pivot', () => {
  const pivot = TURNTABLE.pivot;
  const dx = TURNTABLE.tip.x - pivot.x, dy = TURNTABLE.tip.y - pivot.y;
  for (const progress of [0,.25,.5,.75,1]) {
    const angle = needleAngle(progress) * Math.PI/180;
    const tip = needleTip(progress);
    close(tip.x,pivot.x+dx*Math.cos(angle)-dy*Math.sin(angle));
    close(tip.y,pivot.y+dx*Math.sin(angle)+dy*Math.cos(angle));
  }
  assert.ok(needleAngle(0)>0 && needleAngle(1)<90);
});

test('the complete record is reachable with continuous, bounded and inward motion', () => {
  let previous = needleAngle(0);
  for (let index = 1; index <= 1000; index++) {
    const angle = needleAngle(index / 1000);
    assert.ok(Number.isFinite(angle));
    assert.ok(angle > previous && angle - previous < .1);
    previous = angle;
  }
  close(needleAngle(-100), needleAngle(0));
  close(needleAngle(100), needleAngle(1));
  for (const malformed of [NaN, Infinity, -Infinity, undefined, 'invalid']) {
    close(needleAngle(malformed), needleAngle(0));
    assert.ok(Object.values(needleTip(malformed)).every(Number.isFinite));
  }
});
