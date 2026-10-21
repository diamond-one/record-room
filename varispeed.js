/** A turntable's speed changes continuously; the area under that curve is source time. */
export function rampRate(ramp, time) {
  const elapsed = Math.max(0, time - ramp.at);
  if (ramp.duration <= 0 || elapsed >= ramp.duration) return ramp.target;
  return ramp.from + (ramp.target - ramp.from) * elapsed / ramp.duration;
}

/** Exact integral of the linear AudioParam ramp, including the settled speed after it. */
export function rampDistance(ramp, time) {
  const elapsed = Math.max(0, time - ramp.at);
  if (ramp.duration <= 0) return elapsed * ramp.target;
  const changing = Math.min(elapsed, ramp.duration);
  return ramp.from * changing
    + (ramp.target - ramp.from) * changing * changing / (2 * ramp.duration)
    + Math.max(0, elapsed - ramp.duration) * ramp.target;
}

/** Retarget an existing source without resetting its sample cursor or stepping its speed. */
export function scheduleRate(param, from, target, now, duration) {
  // cancelAndHold preserves the audible value when a Q-Link retargets an unfinished ramp.
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  if (duration > 0) param.linearRampToValueAtTime(target, now + duration);
  else param.setValueAtTime(target, now);
}
