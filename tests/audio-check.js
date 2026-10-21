import { rampRate, rampDistance, scheduleRate } from '../varispeed.js';

const sampleRate = 48000;
const seconds = 2;
const frequency = 440;
const toleranceHz = 2;
const results = [];
const add = (name, expected, measured, pass) => results.push({ name, expected, measured, pass });

function frequencyIn(buffer, start, end) {
  const data = buffer.getChannelData(0);
  const crossings = [];
  for (let index = Math.max(1, Math.floor(start * sampleRate)); index < Math.min(data.length, Math.ceil(end * sampleRate)); index++) {
    if (data[index - 1] <= 0 && data[index] > 0) {
      // Sub-sample interpolation reduces measurement error at lower playback speeds.
      const fraction = -data[index - 1] / (data[index] - data[index - 1]);
      crossings.push((index - 1 + fraction) / sampleRate);
    }
  }
  return crossings.length > 1 ? (crossings.length - 1) / (crossings.at(-1) - crossings[0]) : NaN;
}

function cyclesIn(buffer) {
  const data = buffer.getChannelData(0);
  let count = 0;
  for (let index = 1; index < data.length; index++) {
    if (data[index - 1] <= 0 && data[index] > 0) count++;
  }
  return count;
}

function makeRender() {
  const context = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
  const buffer = context.createBuffer(1, sampleRate * 4, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = 0.8 * Math.sin(2 * Math.PI * frequency * index / sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination); // This is the offline destination, never a speaker.
  source.start();
  return { context, source };
}

function checkFrequency(name, buffer, start, end, expected) {
  const measured = frequencyIn(buffer, start, end);
  add(name, `${expected.toFixed(1)} Hz ± ${toleranceHz}`, `${measured.toFixed(2)} Hz`, Number.isFinite(measured) && Math.abs(measured - expected) <= toleranceHz);
}

async function run() {
  if (typeof OfflineAudioContext !== 'function') throw new Error('OfflineAudioContext is unavailable in this browser.');
  const first = makeRender();
  const initial = { at: 0.15, from: 1, target: 0.5, duration: 1 };
  scheduleRate(first.source.playbackRate, initial.from, initial.target, initial.at, initial.duration);
  const sweep = await first.context.startRendering();
  checkFrequency('Original speed', sweep, 0.02, 0.12, 440);
  checkFrequency('After slowing to half speed', sweep, 1.3, 1.5, 220);
  const expectedSweepCycles = frequency * (initial.at + rampDistance(initial, seconds));
  const measuredSweepCycles = cyclesIn(sweep);
  add('Sweep source position / elapsed cycles', `${expectedSweepCycles.toFixed(2)} cycles ± 2`, `${measuredSweepCycles} cycles`, Math.abs(measuredSweepCycles - expectedSweepCycles) <= 2);
  add('Offline render duration', '2.000 seconds / 96,000 frames', `${sweep.duration.toFixed(3)} seconds / ${sweep.length.toLocaleString('en-US')} frames`, sweep.length === seconds * sampleRate);

  const second = makeRender();
  scheduleRate(second.source.playbackRate, initial.from, initial.target, initial.at, initial.duration);
  // Retarget at the actual render cursor, as a moving physical Q-Link does in real time.
  const suspended = second.context.suspend(0.65);
  const rendering = second.context.startRendering();
  await suspended;
  const retargetAt = second.context.currentTime;
  const next = { at: retargetAt, from: rampRate(initial, retargetAt), target: 1.25, duration: 0.4 };
  scheduleRate(second.source.playbackRate, next.from, next.target, next.at, next.duration);
  await second.context.resume();
  const interrupted = await rendering;
  checkFrequency('Retarget: original speed preserved', interrupted, 0.02, 0.12, 440);
  checkFrequency('Retarget: finishes at 125% speed', interrupted, 1.3, 1.5, 550);
  const expectedRetargetCycles = frequency * (initial.at + rampDistance(initial, retargetAt) + rampDistance(next, seconds));
  const measuredRetargetCycles = cyclesIn(interrupted);
  add('Interrupted ramp keeps continuous source position', `${expectedRetargetCycles.toFixed(2)} cycles ± 2`, `${measuredRetargetCycles} cycles`, Math.abs(measuredRetargetCycles - expectedRetargetCycles) <= 2);
  const peak = interrupted.getChannelData(0).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  add('Output remains bounded', 'Peak ≤ 0.801', peak.toFixed(5), Number.isFinite(peak) && peak <= 0.801);
  document.querySelector('#details').textContent = `48 kHz render. Retarget applied at ${retargetAt.toFixed(6)} s from ${(next.from * 100).toFixed(3)}% speed. Frequency is measured from rendered positive-going zero crossings; total cycles verify the integrated playback cursor.`;
}

function display() {
  const tbody = document.querySelector('#results');
  for (const result of results) {
    const row = document.createElement('tr');
    for (const value of [result.name, result.expected, result.measured, result.pass ? 'PASS' : 'FAIL']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    row.lastElementChild.className = result.pass ? 'pass' : 'fail';
    tbody.append(row);
  }
  const failed = results.filter((result) => !result.pass).length;
  document.body.dataset.result = failed ? 'fail' : 'pass';
  document.querySelector('#summary').textContent = failed
    ? `${failed} of ${results.length} checks failed.`
    : `All ${results.length} audio checks passed. Real pitch follows speed, and interrupted ramps preserve the sample position.`;
  window.audioCheckResults = { pass: failed === 0, results };
}

Promise.race([
  run(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Audio rendering timed out.')), 15000)),
]).catch((error) => add('Browser audio rendering', 'Completes successfully', error.message, false)).finally(display);
