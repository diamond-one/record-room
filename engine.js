/** Record Room playback. Remote records stay in the visible, official YouTube player. */
import { rampRate, rampDistance, scheduleRate } from './varispeed.js';

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;
const MIN_MOTOR_RATE = 0.0001;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => {
  if (value === null || value === '' || typeof value === 'boolean') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const copy = (value) => typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value));

/** Accept the original Sample Digging array, or a backup containing favorites/favourites. */
export function normalizeCrate(input) {
  const rows = Array.isArray(input) ? input
    : input && typeof input === 'object' && (input.favorites ?? input.favourites);
  if (!Array.isArray(rows)) {
    throw new Error('Choose a favourites JSON array, or a backup with a favorites/favourites array.');
  }
  const records = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const youtubeId = [row.youtubeId, row.videoId].find((id) => typeof id === 'string' && YOUTUBE_ID.test(id));
    if (!youtubeId) continue; // Sample Digging's long videoId is an internal ID, not a YouTube ID.
    const raw = copy(row);
    const duration = Math.max(0, finite(row.duration));
    const limit = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    const sampleIn = clamp(finite(row.sampleIn), 0, limit);
    const end = clamp(finite(row.sampleOut), 0, limit);
    const year = finite(row.year, NaN);
    const record = {
      ...raw,
      id: youtubeId,
      youtubeId,
      title: text(row.title) || text(row.trackTitle) || 'Untitled record',
      artist: text(row.artist),
      trackTitle: text(row.trackTitle),
      channel: text(row.channel),
      genre: text(row.genre),
      year: Number.isInteger(year) && year > 0 && year < 10000 ? year : null,
      sampleIn,
      sampleOut: end > sampleIn ? end : 0,
    };
    if (!records.has(youtubeId)) {
      records.set(youtubeId, record);
      continue;
    }
    const existing = records.get(youtubeId);
    for (const [key, value] of Object.entries(record)) {
      if (existing[key] == null || existing[key] === '' || (key === 'title' && existing[key] === 'Untitled record')) {
        existing[key] = value;
      }
    }
    const incomingSelection = record.sampleOut > record.sampleIn;
    if (existing.sampleOut === 0 && incomingSelection) {
      existing.sampleIn = record.sampleIn;
      existing.sampleOut = record.sampleOut;
    } else if (existing.sampleIn === 0 && existing.sampleOut === 0 && record.sampleIn > 0) {
      existing.sampleIn = record.sampleIn;
    }
  }
  if (!records.size && rows.length) throw new Error('No playable YouTube IDs were found in this favourites file.');
  return [...records.values()];
}

export function formatTime(seconds) {
  const total = Math.floor(Math.max(0, finite(seconds)));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Fine mode scans the thirty seconds around an anchor, clipped at the record boundaries. */
export function scanTarget(value, duration, mode = 'whole', anchor = 0) {
  const length = Math.max(0, finite(duration));
  const position = clamp(finite(value), 0, 127) / 127;
  if (mode !== 'fine' && mode !== 'window') return position * length;
  const center = clamp(finite(anchor), 0, length);
  const low = Math.max(0, center - 15);
  const high = Math.min(length, center + 15);
  return low + position * (high - low);
}

/** The centre detent accepts CC 63–65; both physical extremes still reach ±8%. */
export function pitchFromCC(value) {
  const cc = clamp(finite(value, 64), 0, 127);
  if (cc >= 63 && cc <= 65) return 1;
  return cc < 63 ? 0.92 + (cc / 63) * 0.08 : 1 + ((cc - 65) / 62) * 0.08;
}

/** A normalised RMS/peak envelope from decoded local audio, never an invented stream waveform. */
export function analyseGrooves(buffer, bins = 220) {
  const count = clamp(Math.round(finite(bins, 220)), 1, 4096);
  const envelope = new Float32Array(count);
  const length = Math.max(0, Math.floor(finite(buffer?.length)));
  const channels = Math.max(0, Math.floor(finite(buffer?.numberOfChannels)));
  if (!length || !channels || typeof buffer?.getChannelData !== 'function') return envelope;
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let maximum = 0;
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor(bin * length / count);
    const end = Math.min(length, Math.max(start + 1, Math.floor((bin + 1) * length / count)));
    let squared = 0;
    let peak = 0;
    let samples = 0;
    for (const channel of data) {
      for (let index = start; index < end; index++) {
        const amplitude = Math.abs(finite(channel[index]));
        squared += amplitude * amplitude;
        peak = Math.max(peak, amplitude);
        samples++;
      }
    }
    const level = samples ? Math.sqrt(squared / samples) * 0.75 + peak * 0.25 : 0;
    envelope[bin] = level;
    maximum = Math.max(maximum, level);
  }
  if (maximum) for (let index = 0; index < count; index++) envelope[index] /= maximum;
  return envelope;
}

/** Soft takeover: ignore an absolute MIDI fader until it reaches/crosses the displayed value. */
export class Pickup {
  constructor(target = 64, tolerance = 2) {
    this.tolerance = Math.max(0, finite(tolerance, 2));
    this.reset(target);
  }
  reset(target = 64) {
    this.target = clamp(finite(target, 64), 0, 127);
    this.previous = null;
    this.caught = false;
  }
  update(value) {
    const cc = clamp(finite(value), 0, 127);
    if (this.caught) return true;
    const crossed = this.previous !== null
      && Math.min(this.previous, cc) <= this.target && Math.max(this.previous, cc) >= this.target;
    this.caught = Math.abs(cc - this.target) <= this.tolerance || crossed;
    this.previous = cc;
    return this.caught;
  }
}

let youtubeAPI;
function loadYouTubeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (youtubeAPI) return youtubeAPI;
  if (typeof document === 'undefined') return Promise.reject(new Error('YouTube playback needs a browser.'));
  youtubeAPI = new Promise((resolve, reject) => {
    let done = false;
    const previous = globalThis.onYouTubeIframeAPIReady;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (globalThis.onYouTubeIframeAPIReady === ready) globalThis.onYouTubeIframeAPIReady = previous;
      if (error) { youtubeAPI = null; reject(error); }
      else resolve(globalThis.YT);
    };
    const ready = () => {
      try { if (typeof previous === 'function') previous(); } finally { finish(); }
    };
    globalThis.onYouTubeIframeAPIReady = ready;
    const timeout = setTimeout(() => finish(new Error('YouTube did not respond. Check your connection or attach local audio.')), 20000);
    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.addEventListener('error', () => {
        script.remove();
        finish(new Error('YouTube could not load. Check your connection or attach local audio.'));
      }, { once: true });
      document.head.append(script);
    }
  });
  return youtubeAPI;
}

const youtubeErrors = {
  2: 'YouTube rejected this record ID.',
  5: 'This browser could not play the YouTube video. Try opening its source or attach local audio.',
  100: 'This record is unavailable on YouTube. Choose another record or attach local audio.',
  101: 'The uploader has disabled embedded playback. Open its source or attach local audio.',
  150: 'The uploader has disabled embedded playback. Open its source or attach local audio.',
  153: 'YouTube could not identify this app. Open Record Room through its local web address, then retry.',
};

export class DeckAudio extends EventTarget {
  constructor() {
    super();
    this._source = 'none';
    this._name = '';
    this._buffer = null;
    this._context = null;
    this._node = null;
    this._gain = null;
    this._offset = 0;
    this._startedAt = 0;
    this._rate = 1;
    this._rateRamp = { at: 0, from: 1, target: 1, duration: 0 };
    this._motorStopAt = null;
    this._motorTimer = null;
    this._playing = false;
    this._generation = 0;
    this._playGeneration = 0;
    this._player = null;
    this._youtubeReady = null;
    this._youtubeCued = false;
    this._youtubeState = null;
    this._youtubeId = '';
    this._endArmed = false;
    this._destroyed = false;
    this.lastError = null;
  }

  _event(type, detail) {
    const event = typeof CustomEvent === 'function' ? new CustomEvent(type, { detail }) : new Event(type);
    if (!('detail' in event)) Object.defineProperty(event, 'detail', { value: detail });
    this.dispatchEvent(event);
  }
  _change() { this._event('change', { playing: this.playing, isLocal: this.isLocal, rate: this._rate, motorStopping: this.motorStopping }); }
  _error(error) {
    this._endArmed = false;
    if (this._source === 'youtube') this._youtubeState = null;
    const problem = error instanceof Error ? error : new Error(String(error));
    this.lastError = problem;
    this._event('error', { message: problem.message, code: problem.code, videoId: this._source === 'youtube' ? this._youtubeId : null });
    return problem;
  }
  _audioContext() {
    if (this._destroyed) throw new Error('This player has been closed.');
    if (!this._context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Local audio playback is not supported in this browser.');
      this._context = new Context();
    }
    return this._context;
  }
  _stopNode() {
    this._cancelMotorStop(false);
    if (this._node) {
      this._node.onended = null;
      try { this._node.stop(); } catch { /* The node may have ended between events. */ }
      this._node.disconnect();
      this._node = null;
    }
    this._gain?.disconnect();
    this._gain = null;
  }

  _cancelMotorStop(restoreGain = true) {
    clearTimeout(this._motorTimer);
    this._motorTimer = null;
    const stoppedAt = this._motorStopAt;
    this._motorStopAt = null;
    if (restoreGain && stoppedAt !== null && this._gain && this._context) {
      const now = this._context.currentTime;
      const audibleGain = clamp((stoppedAt - now) / 0.008, 0, 1);
      scheduleRate(this._gain.gain, audibleGain, 1, now, 0.005);
    }
  }

  _setLocalRamp(target, duration, position = this.currentTime) {
    const now = this._context.currentTime;
    const actual = rampRate(this._rateRamp, now);
    this._offset = position;
    this._startedAt = now;
    this._rateRamp = { at: now, from: actual, target, duration };
    scheduleRate(this._node.playbackRate, actual, target, now, duration);
  }

  _finishMotorStop() {
    if (this._motorStopAt === null || !this._node) return;
    const remaining = this._motorStopAt - this._context.currentTime;
    if (remaining > 0) {
      // Audio time can stop while the context is suspended; a wall clock timer cannot decide it.
      this._motorTimer = setTimeout(() => this._finishMotorStop(), Math.max(10, remaining * 1000));
      return;
    }
    this._offset = this.currentTime;
    this._stopNode();
    this._playing = false;
    this._change();
  }
  _deactivate() {
    this._endArmed = false;
    this._playGeneration++;
    this._stopNode();
    if (this._player?.pauseVideo) this._player.pauseVideo();
    this._youtubeState = null;
    this._playing = false;
  }

  async attachLocal(file) {
    const generation = ++this._generation;
    try {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an audio file from this computer.');
      const context = this._audioContext();
      const bytes = await file.arrayBuffer();
      if (generation !== this._generation || this._destroyed) return null;
      const buffer = await context.decodeAudioData(bytes.slice(0));
      if (generation !== this._generation || this._destroyed) return null;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('This file contains no playable audio.');
      this._deactivate();
      this.lastError = null;
      this._source = 'local';
      this._buffer = buffer;
      this._name = text(file.name) || 'Local audio';
      this._offset = 0;
      this._rate = 1;
      this._youtubeCued = false;
      this._change();
      return buffer;
    } catch (error) {
      if (generation !== this._generation || this._destroyed) return null;
      throw this._error(new Error(`Could not open local audio: ${error.message || error}`));
    }
  }

  async _ensureYouTube() {
    if (this._youtubeReady) return this._youtubeReady;
    this._youtubeReady = (async () => {
      const YT = await loadYouTubeAPI();
      if (this._destroyed) throw new Error('This player has been closed.');
      if (!document.getElementById('youtube-player')) throw new Error('The visible YouTube player is missing from this page.');
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('The YouTube player did not become ready. Check your connection and retry.')), 20000);
        this._youtubeReadyTimer = timeout;
        this._youtubeReject = reject;
        this._player = new YT.Player('youtube-player', {
          width: '100%', height: '240',
          playerVars: { playsinline: 1, autoplay: 0, controls: 1, origin: globalThis.location?.origin || '' },
          events: {
            onReady: (event) => { clearTimeout(timeout); this._youtubeReject = null; resolve(event.target); },
            onStateChange: (event) => {
              if (this._destroyed || this._source !== 'youtube') return;
              const loaded = event.target.getVideoData?.().video_id;
              if (loaded && loaded !== this._youtubeId) return;
              const ended=event.data===0&&this._endArmed&&loaded===this._youtubeId;
              if(event.data===1)this._endArmed=true;
              else if([0,2,5,-1].includes(event.data))this._endArmed=false;
              if ([-1, 0, 1, 2, 3, 5].includes(event.data)) this._youtubeState = event.data;
              if (loaded === this._youtubeId && [0, 1, 2, 3, 5].includes(event.data)) this._youtubeCued = true;
              this._playing = event.data === 1;
              this._rate = finite(event.target.getPlaybackRate?.(), 1);
              this._change();
              if(ended)this._event('ended',{source:'youtube',videoId:loaded});
            },
            onPlaybackRateChange: (event) => {
              if (this._source !== 'youtube' || this._destroyed) return;
              this._rate = finite(event.data, 1);
              this._change();
            },
            onError: (event) => {
              if (this._source !== 'youtube' || this._destroyed) return;
              const loaded = event.target?.getVideoData?.().video_id;
              if (loaded && loaded !== this._youtubeId) return;
              this._playing = false;
              const error = new Error(youtubeErrors[event.data] || `YouTube playback failed (${event.data}).`);
              error.code = event.data; this._error(error);
              this._change();
            },
            onAutoplayBlocked: () => {
              this._playing = false;
              this._error(Object.assign(new Error('YouTube blocked automatic playback. Press Play in the YouTube player below, or open YouTube.'), {code:'autoplay'}));
              this._change();
            },
          },
        });
      });
    })();
    this._youtubeReady.catch(() => { this._youtubeReady = null; });
    return this._youtubeReady;
  }

  async useYouTube(id, {autoPlay=false,startAt=0}={}) {
    const generation = ++this._generation;
    try {
      if (!YOUTUBE_ID.test(id)) throw new Error('Choose a record with a valid YouTube ID.');
      if (this._destroyed) throw new Error('This player has been closed.');
      this._deactivate();
      this.lastError = null;
      this._source = 'youtube';
      this._buffer = null;
      this._youtubeId = id;
      this._youtubeCued = false;
      this._youtubeState = null;
      this._name = id;
      this._offset = Math.max(0,finite(startAt));
      this._rate = 1;
      this._change();
      const player = await this._ensureYouTube();
      if (generation !== this._generation || this._destroyed) return null;
      if(autoPlay)player.loadVideoById({videoId:id,startSeconds:this._offset});
      else player.cueVideoById({ videoId: id, startSeconds: this._offset });
      player.setPlaybackRate(1);
      this._change();
      return player;
    } catch (error) {
      if (generation !== this._generation || this._destroyed) return null;
      throw this._error(error);
    }
  }

  _startLocal({ startRate = this._rate, glide = 0 } = {}) {
    if (!this._buffer) return;
    if (this._offset >= this.duration) this._offset = 0;
    const context = this._audioContext();
    const node = context.createBufferSource();
    node.buffer = this._buffer;
    const now = context.currentTime;
    node.playbackRate.setValueAtTime(startRate, now);
    this._rateRamp = { at: now, from: startRate, target: this._rate, duration: glide };
    if (glide > 0) node.playbackRate.linearRampToValueAtTime(this._rate, now + glide);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.005);
    node.connect(gain);
    gain.connect(context.destination);
    this._gain = gain;
    this._node = node;
    this._startedAt = context.currentTime;
    this._playing = true;
    node.onended = () => {
      if (this._node !== node || this._source !== 'local') return;
      const ended=!this.motorStopping;
      this._offset = this.duration;
      this._playing = false;
      this._node = null;
      this._cancelMotorStop(false);
      node.disconnect();
      gain.disconnect();
      if (this._gain === gain) this._gain = null;
      this._change();
      if(ended)this._event('ended',{source:'local'});
    };
    node.start(0, this._offset);
  }

  /** Unlock local audio from a real browser gesture without starting the record. */
  async preparePlayback() { await this._audioContext().resume(); }

  async play() {
    if (this._destroyed) return;
    const generation = this._generation;
    const playGeneration = ++this._playGeneration;
    try {
      if (this.isLocal) {
        if (this._playing) {
          if (this.motorStopping) {
            const position = this.currentTime;
            this._cancelMotorStop();
            this._setLocalRamp(this._rate, 0, position);
            this._change();
          }
          return;
        }
        await this._audioContext().resume();
        if (generation !== this._generation || playGeneration !== this._playGeneration || this._destroyed) return;
        this._startLocal();
        this._change();
      } else if (this._source === 'youtube') {
        const player = await this._ensureYouTube();
        if (generation !== this._generation || playGeneration !== this._playGeneration || this._destroyed) return;
        // cueVideoById is asynchronous. An explicit start before its cue event must name
        // the selected record, rather than trying to resume an empty/stale player queue.
        if (!this._youtubeCued || player.getVideoData?.().video_id !== this._youtubeId) player.loadVideoById({ videoId: this._youtubeId, startSeconds: this._offset });
        else player.playVideo(); // Actual playback state comes back through onStateChange.
      }
    } catch (error) { throw this._error(error); }
  }

  /** Audible coupled pitch/speed acceleration. Cueing still uses immediate play()/pause(). */
  async motorStart({ duration = 0.35 } = {}) {
    if (!this.isLocal) return this.play();
    if (this._destroyed) return;
    const generation = this._generation;
    const playGeneration = ++this._playGeneration;
    try {
      await this._audioContext().resume();
      if (generation !== this._generation || playGeneration !== this._playGeneration || this._destroyed) return;
      const glide = clamp(finite(duration, 0.35), 0, 3);
      if (this._playing && this._node) {
        if (!this.motorStopping) return;
        const position = this.currentTime;
        this._cancelMotorStop();
        this._setLocalRamp(this._rate, glide, position);
      } else {
        this._cancelMotorStop();
        this._startLocal({ startRate: glide > 0 ? MIN_MOTOR_RATE : this._rate, glide });
      }
      this._change();
    } catch (error) { throw this._error(error); }
  }

  /** Brake the record to rest, then stop the node without leaving a nearly-static sample audible. */
  motorStop({ duration = 0.6 } = {}) {
    if (!this.isLocal) { this.pause(); return; }
    this._playGeneration++;
    if (!this._playing || !this._node || this.motorStopping) return;
    const glide = clamp(finite(duration, 0.6), 0, 3);
    if (glide === 0) { this.pause(); return; }
    this._setLocalRamp(MIN_MOTOR_RATE, glide);
    const now = this._context.currentTime;
    this._motorStopAt = now + glide;
    // Fade only the last 8 ms; the preceding fall in pitch is real resampled audio.
    const gain = this._gain.gain;
    scheduleRate(gain, 1, 1, now, 0);
    gain.setValueAtTime(1, Math.max(now, this._motorStopAt - 0.008));
    gain.linearRampToValueAtTime(0, this._motorStopAt);
    this._motorTimer = setTimeout(() => this._finishMotorStop(), glide * 1000);
    this._change();
  }

  pause() {
    this._endArmed = false;
    this._playGeneration++;
    if (this.isLocal) {
      this._offset = this.currentTime;
      this._stopNode();
    } else if (this._source === 'youtube') this._player?.pauseVideo?.();
    this._playing = false;
    this._change();
  }

  seek(seconds) {
    const position = clamp(finite(seconds), 0, this.duration || Number.MAX_SAFE_INTEGER);
    if (this.isLocal) {
      const resume = this.playing && position < this.duration;
      this._stopNode();
      this._offset = position;
      this._playing = false;
      if (resume) this._startLocal();
    } else if (this._source === 'youtube') {
      this._offset = position;
      this._player?.seekTo?.(position, true);
    }
    this._change();
    return position;
  }

  /** Local rate is the selected target; currentRate follows the audible ramp. */
  setRate(rate, { glide = 0.18 } = {}) {
    const requested = clamp(finite(rate, 1), this.isLocal ? 0.5 : 0.25, 2);
    if (this.isLocal) {
      this._rate = requested;
      if (this._playing && !this.motorStopping) this._setLocalRamp(requested, clamp(finite(glide, 0.18), 0, 3));
    } else if (this._source === 'youtube' && this._player?.setPlaybackRate) {
      const rates = this.availableRates;
      const nearest = rates.reduce((best, next) => Math.abs(next - requested) < Math.abs(best - requested) ? next : best, rates[0]);
      this._player.setPlaybackRate(nearest);
      this._rate = finite(this._player.getPlaybackRate?.(), 1);
    }
    this._change();
    return this._rate;
  }

  get currentTime() {
    if (this.isLocal) {
      const now = this._motorStopAt === null ? this._context?.currentTime : Math.min(this._context.currentTime, this._motorStopAt);
      const elapsed = this._playing ? rampDistance(this._rateRamp, now) : 0;
      return clamp(this._offset + elapsed, 0, this.duration);
    }
    if (this._source === 'youtube' && this._youtubeCued) return Math.max(0, finite(this._player?.getCurrentTime?.(), this._offset));
    return this._offset;
  }
  get duration() {
    if (this.isLocal) return this._buffer.duration;
    return this._source === 'youtube' && this._youtubeCued ? Math.max(0, finite(this._player?.getDuration?.())) : 0;
  }
  get playing() { return this._playing && !(this._motorStopAt !== null && this._context.currentTime >= this._motorStopAt); }
  get buffering() { return this._source === 'youtube' && this._youtubeState === 3; }
  get motorStopping() { return this._motorStopAt !== null; }
  get currentRate() {
    if (!this.isLocal) return this._rate;
    return this.playing ? rampRate(this._rateRamp, this._context.currentTime) : 0;
  }
  get isLocal() { return this._source === 'local' && !!this._buffer; }
  get availableRates() {
    if (this.isLocal) return [];
    const rates = this._player?.getAvailablePlaybackRates?.();
    const valid = Array.isArray(rates) ? rates.filter((rate) => Number.isFinite(rate) && rate > 0) : [];
    return valid.length ? valid : [1];
  }
  get buffer() { return this._buffer; }
  get name() { return this._name; }
  get rate() { return this._rate; }

  destroy() {
    this._generation++;
    this._deactivate();
    this._destroyed = true;
    clearTimeout(this._youtubeReadyTimer);
    this._youtubeReject?.(new Error('This player has been closed.'));
    this._youtubeReject = null;
    this._player?.destroy?.();
    if (this._context?.close) this._context.close().catch(() => {});
    this._source = 'none';
    this._buffer = null;
    this._offset = 0;
  }
}
