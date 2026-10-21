import {PadTransport} from '../interactions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCrate, formatTime, scanTarget, pitchFromCC, analyseGrooves, Pickup, DeckAudio } from '../engine.js';

const valid = 'TXvegzWNIps';
test('imports the supplied schema without confusing internal video IDs, losing metadata or mutating input', () => {
  const input = [{ youtubeId: valid, videoId: 'cmpzhuxy2yxgfwmpt4uwvksem', title: ' Record ', artist: null, year: '1971', sampleIn: -1, sampleOut: Infinity, extra: { note: 'keep' } }];
  const crate = normalizeCrate(input);
  assert.equal(crate[0].id, valid);
  assert.equal(crate[0].title, 'Record');
  assert.equal(crate[0].year, 1971);
  assert.equal(crate[0].sampleIn, 0);
  assert.equal(crate[0].sampleOut, 0);
  assert.equal(input[0].title, ' Record ');
  crate[0].extra.note = 'new';
  assert.equal(input[0].extra.note, 'keep');
  assert.throws(() => normalizeCrate([{ videoId: 'cmpzhuxy2yxgfwmpt4uwvksem' }]), /No playable/);
  assert.equal(normalizeCrate([{ videoId: valid }])[0].youtubeId, valid);
});

test('supports explicit backup wrappers, merges duplicates and repairs marker ranges', () => {
  const rows = [
    { youtubeId: valid, title: 'Original title', duration: 30, sampleIn: 25, sampleOut: 10 },
    { youtubeId: valid, title: 'Other title', genre: 'Funk', sampleIn: 2, sampleOut: 8 },
    { youtubeId: '5nJkrKAL8Ho', sampleIn: 20, sampleOut: 90, duration: 25 },
    null, { youtubeId: 'bad' },
  ];
  const result = normalizeCrate({ favourites: rows });
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Original title');
  assert.equal(result[0].genre, 'Funk');
  assert.deepEqual([result[0].sampleIn, result[0].sampleOut], [2, 8]);
  assert.equal(result[1].sampleOut, 25);
  assert.deepEqual(normalizeCrate({ favorites: [] }), []);
  assert.throws(() => normalizeCrate({ records: rows }), /favorites\/favourites/);
  assert.throws(() => normalizeCrate({ favorites: {} }), /array/);
});

test('scan boundaries, centre detent and malformed control values stay bounded', () => {
  assert.equal(scanTarget(0, 300), 0);
  assert.equal(scanTarget(127, 300), 300);
  assert.equal(scanTarget(200, 300), 300);
  assert.equal(scanTarget(0, 300, 'fine', 100), 85);
  assert.equal(scanTarget(127, 300, 'fine', 100), 115);
  assert.equal(scanTarget(0, 300, 'fine', 2), 0);
  assert.equal(scanTarget(127, 300, 'fine', 298), 300);
  assert.equal(scanTarget(60, NaN), 0);
  assert.equal(pitchFromCC(0), 0.92);
  assert.equal(pitchFromCC(127), 1.08);
  for (const value of [63, 64, 65, NaN]) assert.equal(pitchFromCC(value), 1);
  assert.equal(formatTime(Infinity), '0:00');
  assert.equal(formatTime(3601.9), '60:01');
});

test('groove analysis reflects actual local energy, silence, stereo and short buffers', () => {
  const audio = (channels) => ({ length: channels[0].length, numberOfChannels: channels.length, getChannelData: (channel) => channels[channel] });
  assert.deepEqual([...analyseGrooves(audio([[0, 0, 0, 0]]), 2)], [0, 0]);
  const levels = analyseGrooves(audio([[0, 0, 0.5, 0.5, 1, 1]]), 3);
  assert.equal(levels[0], 0);
  assert.equal(levels[1], 0.5);
  assert.equal(levels[2], 1);
  assert.deepEqual([...analyseGrooves(audio([[1, 1], [-1, -1]]), 2)], [1, 1]);
  assert.equal(analyseGrooves(audio([[0.5]]), 100).length, 100);
  assert.ok([...analyseGrooves(audio([[NaN, Infinity]]), 2)].every(Number.isFinite));
});

test('absolute MIDI pickup waits for crossing and can be reset after the UI moves', () => {
  const pickup = new Pickup(64, 1);
  assert.equal(pickup.update(0), false);
  assert.equal(pickup.update(40), false);
  assert.equal(pickup.update(80), true);
  assert.equal(pickup.update(10), true);
  pickup.reset(100);
  assert.equal(pickup.update(10), false);
  assert.equal(pickup.update(99), true);
});

class FakeParam {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, at) { this.events.push(['set', value, at]); this.value = value; }
  linearRampToValueAtTime(value, at) { this.events.push(['ramp', value, at]); }
  cancelAndHoldAtTime(at) { this.events.push(['hold', at]); }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); }
}

class FakeContext {
  static instances = [];
  constructor() { this.currentTime = 0; this.destination = {}; this.nodes = []; FakeContext.instances.push(this); }
  async decodeAudioData() { return { duration: 100, length: 100, numberOfChannels: 1, getChannelData: () => new Float32Array(100) }; }
  createBufferSource() {
    const node = { playbackRate: new FakeParam(), connect() {}, disconnect() {}, start(when, offset) { this.offset = offset; }, stop() { this.stopped = true; } };
    this.nodes.push(node);
    return node;
  }
  createGain() { return { gain: new FakeParam(), connect() {}, disconnect() {} }; }
  async resume() {}
  async close() {}
}
const file = (name = 'record.wav') => ({ name, arrayBuffer: async () => new ArrayBuffer(4) });

test('local playback preserves elapsed source time across rate changes, pause and seek', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  try {
    assert.equal(deck.duration, 0);
    assert.equal(deck.currentTime, 0);
    await deck.attachLocal(file());
    const context = FakeContext.instances.at(-1);
    assert.equal(deck.playing, false);
    await deck.play();
    context.currentTime = 10;
    assert.equal(deck.currentTime, 10);
    assert.equal(deck.setRate(2, { glide: 0 }), 2);
    context.currentTime = 15;
    assert.equal(deck.currentTime, 20);
    deck.pause();
    context.currentTime = 40;
    assert.equal(deck.currentTime, 20);
    deck.seek(60);
    await deck.play();
    context.currentTime = 45;
    assert.equal(deck.currentTime, 70);
    deck.seek(1000);
    assert.equal(deck.currentTime, 100);
    assert.equal(deck.playing, false);
    await deck.play();
    assert.equal(deck.currentTime, 0);
    context.nodes.at(-1).onended();
    assert.equal(deck.playing, false);
    assert.equal(deck.currentTime, 100);
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('pitch glides keep the same sample source and integrate elapsed source time through rapid retargets', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  try {
    await deck.attachLocal(file());
    await deck.play();
    const context = FakeContext.instances.at(-1);
    const node = context.nodes[0];
    context.currentTime = 10;
    deck.setRate(2, { glide: 1 });
    assert.equal(deck.rate, 2);
    assert.equal(deck.currentRate, 1);
    context.currentTime = 10.5;
    close(deck.currentRate, 1.5);
    close(deck.currentTime, 10.625);
    deck.setRate(0.5, { glide: 1 });
    close(deck.currentTime, 10.625);
    close(deck.currentRate, 1.5);
    context.currentTime = 11;
    close(deck.currentRate, 1);
    close(deck.currentTime, 11.25);
    deck.setRate(1.08); // The Q-Link default glides rather than stepping in pitch.
    assert.equal(node.playbackRate.events.at(-1)[0], 'ramp');
    assert.equal(context.nodes.length, 1);
    assert.equal(node.stopped, undefined);
    context.currentTime = 11.18;
    close(deck.currentTime, 11.4372);
    close(deck.currentRate, 1.08);
    deck.pause();
    context.currentTime = 99;
    close(deck.currentTime, 11.4372);
    assert.equal(deck.currentRate, 0);
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('motor start and brake change pitch with speed, freeze at rest and retain the selected speed', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  try {
    await deck.attachLocal(file());
    deck.setRate(1.08);
    await deck.motorStart({ duration: 0.4 });
    const context = FakeContext.instances.at(-1);
    close(deck.currentRate, 0.0001);
    context.currentTime = 0.2;
    close(deck.currentRate, 0.54005);
    close(deck.currentTime, 0.054015);
    context.currentTime = 0.4;
    close(deck.currentTime, 0.21602);
    deck.motorStop({ duration: 0.6 });
    assert.equal(deck.motorStopping, true);
    context.currentTime = 0.7;
    close(deck.currentRate, 0.54005);
    close(deck.currentTime, 0.4590275);
    context.currentTime = 1.2; // A delayed UI/timer must not drift after the scheduled stop.
    close(deck.currentTime, 0.54005);
    assert.equal(deck.currentRate, 0);
    assert.equal(deck.playing, false);
    deck._finishMotorStop();
    assert.equal(deck.motorStopping, false);
    assert.equal(context.nodes[0].stopped, true);
    assert.equal(deck.rate, 1.08);
    context.currentTime = 5;
    close(deck.currentTime, 0.54005);
    await deck.motorStart();
    assert.equal(context.nodes.length, 2);
    close(context.nodes[1].offset, 0.54005);
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('restarting a braking motor reuses the source and cancels the scheduled mute and stop', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  try {
    await deck.attachLocal(file());
    await deck.play();
    const context = FakeContext.instances.at(-1);
    deck.motorStop({ duration: 1 });
    context.currentTime = 0.5;
    const position = deck.currentTime;
    const actual = deck.currentRate;
    await deck.motorStart({ duration: 0.4 });
    assert.equal(deck.currentTime, position);
    assert.equal(deck.currentRate, actual);
    assert.equal(deck.motorStopping, false);
    assert.equal(context.nodes.length, 1);
    context.currentTime = 0.9;
    assert.equal(deck.currentRate, 1);
    context.currentTime = 1.2;
    deck._finishMotorStop();
    assert.equal(deck.playing, true);
    assert.equal(context.nodes[0].stopped, undefined);
    deck.motorStop();
    deck.seek(30);
    assert.equal(deck.motorStopping, false);
    assert.equal(deck.currentTime, 30);
    assert.equal(deck.currentRate, 1);
    deck.motorStop();
    deck.pause();
    assert.equal(deck.motorStopping, false);
    const paused = deck.currentTime;
    context.currentTime = 20;
    assert.equal(deck.currentTime, paused);
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('pitch movement during a brake updates the next start without cancelling the brake, and loading cancels it', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  try {
    await deck.attachLocal(file());
    await deck.play();
    const context = FakeContext.instances.at(-1);
    deck.motorStop({ duration: 1 });
    context.currentTime = 0.5;
    const rate = deck.currentRate;
    deck.setRate(0.92);
    assert.equal(deck.rate, 0.92);
    assert.equal(deck.currentRate, rate);
    assert.equal(deck.motorStopping, true);
    await deck.attachLocal(file('next.wav'));
    assert.equal(deck.motorStopping, false);
    assert.equal(deck.playing, false);
    assert.equal(context.nodes[0].stopped, true);
    assert.equal(deck.currentTime, 0);
    assert.equal(deck.rate, 1);
    context.currentTime = 2;
    deck._finishMotorStop();
    assert.equal(deck.currentTime, 0);
    await deck.motorStart();
    deck.destroy();
    assert.equal(deck.playing, false);
    assert.equal(deck.motorStopping, false);
    assert.equal(context.nodes[1].stopped, true);
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('stale local file loads cannot replace a more recent selection', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  let finish;
  const slow = { name: 'old.wav', arrayBuffer: () => new Promise((resolve) => { finish = resolve; }) };
  try {
    const pending = deck.attachLocal(slow);
    await deck.attachLocal(file('new.wav'));
    finish(new ArrayBuffer(4));
    assert.equal(await pending, null);
    assert.equal(deck.name, 'new.wav');
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('decode failures emit an actionable error and preserve the previously loaded record', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  try {
    await deck.attachLocal(file('good.wav'));
    const context = FakeContext.instances.at(-1);
    context.decodeAudioData = async () => { throw new Error('unsupported format'); };
    let message;
    deck.addEventListener('error', (event) => { message = event.detail.message; });
    await assert.rejects(deck.attachLocal(file('bad.bin')), /unsupported format/);
    assert.match(message, /Could not open local audio/);
    assert.equal(deck.name, 'good.wav');
  } finally { deck.destroy(); globalThis.AudioContext = original; }
});

test('YouTube loads cued, never autoplays, and reports accepted rather than requested speed', async () => {
  const saved = { YT: globalThis.YT, document: globalThis.document, AudioContext: globalThis.AudioContext };
  let player;
  class FakePlayer {
    constructor(id, options) {
      assert.equal(id, 'youtube-player');
      assert.equal(options.playerVars.autoplay, 0);
      this.events = options.events;
      this.rate = 1;
      this.time = 0;
      this.id = '';
      this.playCalls = 0;
      player = this;
      queueMicrotask(() => this.events.onReady({ target: this }));
    }
    cueVideoById(options) { this.id = options.videoId; if (!this.deferCue) this.events.onStateChange({ target: this, data: 5 }); }
    loadVideoById(options) { this.loaded = options; this.loadCalls = (this.loadCalls || 0) + 1; this.id = options.videoId; this.time = options.startSeconds; this.events.onStateChange({ target: this, data: 1 }); }
    getVideoData() { return { video_id: this.id }; }
    getCurrentTime() { return this.time; }
    getDuration() { return 240; }
    getPlaybackRate() { return this.rate; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 1, 1.5, 2]; }
    setPlaybackRate(rate) { this.requested = rate; }
    playVideo() { this.playCalls++; this.events.onStateChange({ target: this, data: 1 }); }
    pauseVideo() { this.events.onStateChange({ target: this, data: 2 }); }
    seekTo(time) { this.time = time; }
    destroy() {}
  }
  globalThis.YT = { Player: FakePlayer };
  globalThis.document = { getElementById: () => ({}) };
  globalThis.AudioContext = FakeContext;
  const deck = new DeckAudio();
  try {
    await deck.useYouTube(valid);
    assert.equal(deck.playing, false);
    assert.equal(deck.buffering, false);
    assert.equal(player.playCalls, 0);
    assert.equal(deck.duration, 240);
    assert.equal(deck.isLocal, false);
    assert.equal(deck.buffer, null);
    assert.equal(deck.setRate(1.4), 1);
    assert.equal(player.requested, 1.5);
    deck.setRate(.25);assert.equal(player.requested,.25);
    player.rate = 1.5;
    player.events.onPlaybackRateChange({ target: player, data: 1.5 });
    assert.equal(deck.rate, 1.5);
    await deck.play();
    assert.equal(deck.playing, true);
    const endings=[];deck.addEventListener('ended',event=>endings.push(event.detail));
    player.events.onStateChange({target:player,data:3});
    assert.equal(endings.length,0,'buffering is not an ending');
    player.events.onStateChange({target:player,data:0});
    player.events.onStateChange({target:player,data:0});
    assert.deepEqual(endings,[{source:'youtube',videoId:valid}],'a natural ending fires once');
    await deck.play();deck.pause();
    player.events.onStateChange({target:player,data:0});
    assert.equal(endings.length,1,'late ended after manual pause must not advance');
    await deck.play();
    player.events.onStateChange({ target: player, data: 3 });
    assert.equal(deck.playing, false);
    assert.equal(deck.buffering, true);
    player.events.onStateChange({ target: player, data: 999 });
    assert.equal(deck.buffering, true); // Unknown player states do not replace a valid state.
    deck.seek(999);
    assert.equal(deck.currentTime, 240);
    deck.pause();
    assert.equal(deck.playing, false);
    assert.equal(deck.buffering, false);
    player.events.onStateChange({ target: player, data: 3 });
    player.events.onStateChange({ target: player, data: 0 });
    assert.equal(deck.buffering, false);
    let problem, details;
    deck.addEventListener('error', (event) => { problem = event.detail.message; details = event.detail; });
    player.events.onStateChange({ target: player, data: 3 });
    player.events.onError({ target: player, data: 150 });
    assert.match(problem, /disabled embedded playback/);
    assert.equal(details.code,150);assert.equal(details.videoId,valid);
    assert.equal(deck.buffering, false);
    player.events.onStateChange({ target: player, data: 3 });
    player.events.onAutoplayBlocked();
    assert.equal(deck.buffering, false);
    player.events.onStateChange({ target: player, data: 3 });
    await deck.useYouTube('5nJkrKAL8Ho');
    assert.equal(deck.buffering, false);
    player.events.onStateChange({ target: player, data: 3 });
    assert.equal(deck.buffering, true);
    const playVideo = player.playVideo;
    player.playVideo = () => { throw new Error('player unavailable'); };
    await assert.rejects(deck.play(), /player unavailable/);
    assert.equal(deck.buffering, false);
    player.playVideo = playVideo;
    player.events.onStateChange({ target: player, data: 3 });
    await deck.attachLocal(file());
    assert.equal(deck.buffering, false);
    player.events.onStateChange({ target: player, data: 3 });
    assert.equal(deck.buffering, false); // A late YouTube event cannot alter local playback state.
    player.deferCue = true;
    await deck.useYouTube(valid);
    assert.equal(deck.playing, false);
    assert.equal(player.loadCalls || 0, 0); // Selecting a record still never autoplays.
    deck.seek(13);
    const previousPlayCalls = player.playCalls;
    await deck.play();
    assert.deepEqual(player.loaded, { videoId: valid, startSeconds: 13 });
    assert.equal(player.loadCalls, 1);
    assert.equal(player.playCalls, previousPlayCalls);
    assert.equal(deck.playing, true);
    deck.pause();
    await deck.play();
    assert.equal(player.loadCalls, 1);
    assert.equal(player.playCalls, previousPlayCalls + 1); // A cued record resumes normally.
    player.id = '5nJkrKAL8Ho';
    await deck.play();
    assert.equal(player.loaded.videoId,valid);assert.equal(player.loadCalls,2);
    const loads=player.loadCalls;
    await deck.useYouTube('5nJkrKAL8Ho',{autoPlay:true,startAt:21});
    assert.deepEqual(player.loaded,{videoId:'5nJkrKAL8Ho',startSeconds:21});
    assert.equal(player.loadCalls,loads+1,'autoplay selects and starts in one load, without a cue/play race');
    assert.equal(deck.playing,true);
  } finally {
    deck.destroy();
    globalThis.YT = saved.YT;
    globalThis.document = saved.document;
    globalThis.AudioContext = saved.AudioContext;
  }
});


test('pad release and instant stop cancel a start still waiting for AudioContext resume',async()=>{
  const original=globalThis.AudioContext;globalThis.AudioContext=FakeContext;const deck=new DeckAudio();
  try{
    await deck.attachLocal(file());const context=FakeContext.instances.at(-1),pads=new PadTransport(deck);
    for(const stoppingPad of [14,15]){
      let resume;context.resume=()=>new Promise(resolve=>resume=resolve);pads.press(14);
      if(stoppingPad===14)pads.release(14);else pads.press(15);
      resume();await new Promise(resolve=>setImmediate(resolve));
      assert.equal(deck.playing,false);assert.equal(context.nodes.length,0);
    }
  }finally{await deck.destroy();globalThis.AudioContext=original;}
});

test('momentary pad playback bypasses the motor ramp and release stops the actual sample node',async()=>{
  const original=globalThis.AudioContext;globalThis.AudioContext=FakeContext;const deck=new DeckAudio();
  try{
    await deck.attachLocal(file());const context=FakeContext.instances.at(-1),pads=new PadTransport(deck,{random:()=>.37});
    pads.press(13);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(deck.currentTime,37);assert.equal(deck.currentRate,1);assert.equal(deck.playing,true);
    const node=context.nodes.at(-1);context.currentTime=3;pads.release(13);
    assert.equal(node.stopped,true);assert.equal(deck.playing,false);assert.equal(deck.motorStopping,false);assert.equal(deck.currentTime,40);
    await deck.preparePlayback();assert.equal(deck.playing,false);assert.equal(context.nodes.length,1,'unlocking never creates a playing node');
  }finally{await deck.destroy();globalThis.AudioContext=original;}
});

test('local natural end fires once, while pause, seeking and motor braking do not finish a record',async()=>{
  const original=globalThis.AudioContext;globalThis.AudioContext=FakeContext;const deck=new DeckAudio();
  try{
    await deck.attachLocal(file());const context=FakeContext.instances.at(-1),endings=[];
    deck.addEventListener('ended',event=>endings.push(event.detail));
    await deck.play();let node=context.nodes.at(-1);deck.pause();assert.equal(node.onended,null);
    await deck.play();node=context.nodes.at(-1);deck.seek(20);assert.equal(node.onended,null);
    node=context.nodes.at(-1);deck.motorStop({duration:1});node.onended();assert.equal(endings.length,0);
    await deck.play();node=context.nodes.at(-1);const finish=node.onended;finish();finish();
    assert.deepEqual(endings,[{source:'local'}]);assert.equal(deck.currentTime,100);assert.equal(deck.playing,false);
  }finally{await deck.destroy();globalThis.AudioContext=original;}
});
