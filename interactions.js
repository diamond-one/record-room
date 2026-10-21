/** Shared listening shortcuts, without binding to a document or changing an event. */
export function shortcutAction(event) {
  if (!event || event.defaultPrevented || event.repeat || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey) return null;

  const target = event.target;
  if (/^SUMMARY$/i.test(target?.tagName || '') || target?.closest?.('summary, [data-listening-shortcuts=off]')) return null;
  const range = target?.closest?.('input[type="range"]')
    || (/^INPUT$/i.test(target?.tagName || '') && String(target.type).toLowerCase() === 'range');
  const editing = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';
  if (target?.isContentEditable || (!range && (target?.closest?.(editing)
      || /^(INPUT|SELECT|TEXTAREA)$/i.test(target?.tagName || '')))) return null;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if(target?.closest?.('[role="tab"]')&&['arrowleft','arrowright','home','end',' ','spacebar'].includes(key))return null;
  if (event.code === 'Space' || key === ' ' || key === 'spacebar') return 'toggle';
  if (key === 'r') return 'random';
  if (key === 'd') return 'dig';
  if (key === 'm') return 'mark';
  if (/^[0-9]$/.test(key) && !event.shiftKey) return `jump:${key}`;
  if (key === 'arrowleft' || key === 'arrowright') {
    if (range || target?.closest?.('[role="slider"]') || target?.getAttribute?.('role') === 'slider') return null;
    return key === 'arrowleft' ? 'back' : 'forward';
  }
  return null;
}

/** Shared search/filter semantics for saved records and the discovery pool. */
export function filterRecords(records, {query = '', genre = '', year = ''} = {}) {
  const search = String(query).trim().toLocaleLowerCase();
  return records.filter(record => {
    if (genre && record.genre !== genre && !record.genres?.includes(genre)) return false;
    if (year === 'unknown' && record.year) return false;
    if (year && year !== 'unknown' && (!record.year || (year === '2000' ? record.year < 2000 : Math.floor(record.year / 10) * 10 !== Number(year)))) return false;
    return !search || [record.artist, record.trackTitle, record.title, record.channel].join(' ').toLocaleLowerCase().includes(search);
  });
}

/** A bounded tray; every matching record gets a turn before the pool repeats. */
export class DiscoveryTray {
  constructor(seen = [], random = Math.random) { this.seen = new Set(seen); this.random = random; this.current = []; }
  draw(records) {
    const unique = [...new Map(records.map(record => [record.id, record])).values()];
    let pool = unique.filter(record => !this.seen.has(record.id));
    if (!pool.length && unique.length) {
      for (const record of unique) this.seen.delete(record.id);
      pool = unique.filter(record => !this.current.includes(record.id));
      if (!pool.length) pool = unique;
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.max(0, Math.min(.9999999999999999, this.random())) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const batch = pool.slice(0, 10);
    this.current = batch.map(record => record.id);
    for (const record of batch) this.seen.add(record.id);
    return batch;
  }
}

/** Draw through a filtered crate without repeats, preserving a bag across reordered views. */
export class ShuffleCrate {
  constructor(random = Math.random) {
    this.random = random;
    this.members = new Set();
    this.bag = [];
  }

  next(records, currentId) {
    const pool = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (record && record.id != null && !pool.has(record.id)) pool.set(record.id, record);
    }
    const changed = pool.size !== this.members.size
      || [...pool.keys()].some(id => !this.members.has(id));
    if (changed) {
      this.members = new Set(pool.keys());
      this.bag = [];
    }
    if (!pool.size || (pool.size === 1 && pool.has(currentId))) return null;

    const refill = () => {
      this.bag = [...pool.keys()];
      for (let index = this.bag.length - 1; index > 0; index--) {
        const other = Math.floor(Math.max(0, Math.min(0.9999999999999999, this.random())) * (index + 1));
        [this.bag[index], this.bag[other]] = [this.bag[other], this.bag[index]];
      }
    };
    if (!this.bag.length) refill();
    let index = this.bag.findIndex(id => id !== currentId);
    // A manually chosen current record may be the only unplayed bag entry.
    if (index === -1) {
      refill();
      index = this.bag.findIndex(id => id !== currentId);
    }
    const [id] = this.bag.splice(index, 1);
    return pool.get(id) || null;
  }
}


/** Hardware pads use learned notes (including note-on zero) or on/off CC buttons. */
export const MPC_PAD_ORDER = Object.freeze([13,14,15,16,9,10,11,12,5,6,7,8,1,2,3,4]);
export function padDescription(pad) {
  if(pad<=12)return pad===1?'Record start':`${Math.round((pad-1)/12*100)}% of record`;
  return {13:'Hold: random',14:'Hold: play',15:'Instant stop',16:'Start / stop'}[pad]||'';
}
export function padMidiSignal(data) {
  if(!Array.isArray(data)||data.length<3||!data.slice(0,3).every(Number.isInteger)||data[0]<128||data[0]>239||data[1]<0||data[1]>127||data[2]<0||data[2]>127)return null;
  const command=data[0]&240,channel=(data[0]&15)+1,number=data[1],value=data[2];
  if(command===144||command===128)return {type:'note',channel,number,down:command===144&&value>0};
  if(command===176&&number<120)return {type:'cc',channel,number,down:value>0};
  return null;
}
export function samePadSignal(a,b){return !!a&&!!b&&a.type===b.type&&a.channel===b.channel&&a.number===b.number;}
export function cleanPadMappings(input) {
  const result={};
  if(!input||typeof input!=='object')return result;
  for(let pad=1;pad<=16;pad++){
    const m=input[pad];if(!m||!['note','cc'].includes(m.type)||!Number.isInteger(m.channel)||m.channel<1||m.channel>16||!Number.isInteger(m.number)||m.number<0||m.number>(m.type==='cc'?119:127))continue;
    if(Object.values(result).some(other=>samePadSignal(other,m)))continue;
    result[pad]={type:m.type,channel:m.channel,number:m.number,releaseVerified:m.releaseVerified===true};
  }
  return result;
}
export class MidiPadRouter {
  constructor(){this.held=new Set();}
  clear(){this.held.clear();}
  process(data,mappings){
    const signal=padMidiSignal(data);if(!signal)return null;
    const entry=Object.entries(mappings).find(([,m])=>samePadSignal(signal,m));if(!entry)return null;
    const pad=Number(entry[0]),key=`${signal.type}:${signal.channel}:${signal.number}`;
    if(signal.down){if(this.held.has(key))return null;this.held.add(key);}
    else{if(!this.held.delete(key))return null;}
    return {pad,down:signal.down,releaseVerified:entry[1].releaseVerified===true};
  }
}
/** Gate ownership and immediate pause cancel pending asynchronous starts in DeckAudio. */
export class PadTransport {
  constructor(deck,{ready=()=>true,onStart=()=>{},onStop=()=>{},beforeSeek=()=>{},onSeek=()=>{},onToggle=()=>{},onUnavailable=()=>{},onError=()=>{},random=Math.random}={}){
    Object.assign(this,{deck,ready,onStart,onStop,beforeSeek,onSeek,onToggle,onUnavailable,onError,random});this.gate=null;
  }
  stop(){this.gate=null;this.onStop();this.deck.pause();}
  cancelHold(stop=true){const held=this.gate!==null;this.gate=null;if(held&&stop)this.stop();}
  press(pad){
    if(!Number.isInteger(pad)||pad<1||pad>16)return;
    if(pad===15){this.stop();return;}
    if(pad===16){this.gate=null;this.onToggle();return;}
    if(!this.ready()||!this.deck.duration){this.onUnavailable();return;}
    if(pad<=12){const time=this.deck.duration*(pad-1)/12;this.beforeSeek(time);this.deck.seek(time);this.onSeek(time);return;}
    this.gate=pad;
    // Pause first to cancel pending starts and motor ramps, without moving the needle.
    this.deck.pause();
    if(pad===13){const time=Math.max(0,Math.min(.999999,Number(this.random())||0))*this.deck.duration;this.beforeSeek(time);this.deck.seek(time);this.onSeek(time);}
    this.onStart();
    Promise.resolve(this.deck.play()).catch(error=>{if(this.gate===pad)this.stop();this.onError(error);});
  }
  release(pad){if(this.gate===pad)this.stop();}
}


/** A momentary mapping is committed only after its matching release is observed. */
export function learnPadInput(signal,{pad,profile={},reserved=[],pending=null}={}){
  if(!signal||!Number.isInteger(pad)||pad<1||pad>16)return {status:'ignore'};
  if(pending)return !signal.down&&samePadSignal(signal,pending)?{status:'learned',signal:pending,releaseVerified:true}:{status:'ignore'};
  if(!signal.down)return {status:'ignore'};
  const duplicate=Object.entries(profile).find(([number,m])=>Number(number)!==pad&&samePadSignal(signal,m));
  if(duplicate)return {status:'duplicate',pad:Number(duplicate[0])};
  if(reserved.some(m=>samePadSignal(signal,m)))return {status:'reserved'};
  return [13,14].includes(pad)?{status:'release',signal}:{status:'learned',signal,releaseVerified:false};
}
