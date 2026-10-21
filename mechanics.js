import {GROOVES} from './presentation.js';
/**
 * Turntable geometry in deck-width units. The deck height is 1060 / 1200.
 * Keep this in step with the supplied asset viewBox and .record-surface in supplied.css.
 * The full-deck arm SVG and its image mask use the same source coordinates.
 */
// Asset coordinate system: viewBox="20 65 1200 1060".
// The photographed stylus is (939,962); pivot and counterweight share (1052,321).
// Moving artwork is translated up 8 source pixels to the cleaned chassis bearing..
const RADIANS = Math.PI / 180;
export const TURNTABLE = Object.freeze({
  aspect: 1200 / 1060,
  center: {x: (530-20)/1200, y: (555-65)/1200},
  pivot: {x: (1052-20)/1200, y: (321-65)/1200},
  tip: {x: (939-20)/1200, y: (962-65)/1200},
  radius: 397/1200,
});
const CENTER = TURNTABLE.center;
const PIVOT = TURNTABLE.pivot;
const VECTOR = {x: TURNTABLE.tip.x-PIVOT.x, y: TURNTABLE.tip.y-PIVOT.y};
const DELTA = { x: PIVOT.x - CENTER.x, y: PIVOT.y - CENTER.y };
const OUTER = TURNTABLE.radius * 2 * GROOVES.outer;
const INNER = TURNTABLE.radius * 2 * GROOVES.inner;
const PROJECTION = DELTA.x * VECTOR.x + DELTA.y * VECTOR.y;
const CROSS_PROJECTION = DELTA.y * VECTOR.x - DELTA.x * VECTOR.y;
const PROJECTION_LENGTH = Math.hypot(PROJECTION, CROSS_PROJECTION);
const PHASE = Math.atan2(CROSS_PROJECTION, PROJECTION);
const CONSTANT = DELTA.x ** 2 + DELTA.y ** 2 + VECTOR.x ** 2 + VECTOR.y ** 2;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function boundedProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 0;
}

/** Solve the stylus's circular arm path against the requested concentric record groove. */
export function needleAngle(progress) {
  const radius = OUTER + (INNER - OUTER) * boundedProgress(progress);
  const cosine = clamp((radius * radius - CONSTANT) / (2 * PROJECTION_LENGTH), -1, 1);
  // This branch moves inward across the lower-right grooves, from the outside to the runout.
  return (PHASE + Math.acos(cosine)) / RADIANS;
}

/** The actual stylus endpoint, after the headshell and complete arm rotations. */
export function needleTip(progress) {
  const angle = needleAngle(progress) * RADIANS;
  return {
    x: PIVOT.x + VECTOR.x * Math.cos(angle) - VECTOR.y * Math.sin(angle),
    y: PIVOT.y + VECTOR.x * Math.sin(angle) + VECTOR.y * Math.cos(angle),
  };
}

/** 33 1/3 rpm is 200 degrees/second. At 45 rpm the engine rate is 1.35. */
export function advancePlatter(angle, seconds, actualRate) {
  if (![angle, seconds, actualRate].every(Number.isFinite)) return 0;
  return ((angle + Math.max(0,seconds) * 200 * Math.max(0,actualRate)) % 360 + 360) % 360;
}
