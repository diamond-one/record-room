import test from 'node:test';
import assert from 'node:assert/strict';
import {MPC_PAD_ORDER,padMidiSignal,cleanPadMappings,MidiPadRouter,PadTransport,learnPadInput} from '../interactions.js';

const note=(number,down=true,channel=1)=>padMidiSignal([(down?0x90:0x80)+channel-1,number,down?100:64]);

test('pad signals accept Note Off, note-on zero and CC release, while rejecting other/malformed messages',()=>{
  assert.deepEqual(note(60,true,3),{type:'note',number:60,channel:3,down:true});
  assert.equal(note(60,false).down,false);
  assert.equal(padMidiSignal([0x90,60,0]).down,false);
  assert.equal(padMidiSignal([0xb0,40,0]).down,false);
  assert.equal(padMidiSignal([0xb0,40,127]).down,true);
  for(const data of [[0xa0,60,70],[0xe0,0,64],[0xb0,123,0],[0x90,128,100],[0x90,-1,2],[0x90,1,1.5],[0x90,60],null])assert.equal(padMidiSignal(data),null);
});

test('pad router honors learned channel/note, debounces repeats and isolates device profiles',()=>{
  const router=new MidiPadRouter(),a={1:{type:'note',number:36,channel:2}},b={1:{type:'note',number:60,channel:1}};
  assert.equal(router.process([0x90,36,100],a),null);
  assert.deepEqual(router.process([0x91,36,100],a),{pad:1,down:true,releaseVerified:false});
  assert.equal(router.process([0x91,36,101],a),null);
  assert.deepEqual(router.process([0x91,36,0],a),{pad:1,down:false,releaseVerified:false});
  assert.equal(router.process([0x81,36,0],a),null);
  router.clear();assert.equal(router.process([0x91,36,100],b),null);
  assert.equal(router.process([0x90,60,100],b).pad,1);
});

test('CC pad buttons use distinct press/release edges and mapping restore rejects invalid or duplicate bindings',()=>{
  const mappings=cleanPadMappings({13:{type:'cc',number:40,channel:1,releaseVerified:true},14:{type:'cc',number:40,channel:1},15:{type:'note',number:36,channel:17},16:{type:'note',number:64,channel:1}});
  assert.deepEqual(Object.keys(mappings),['13','16']);assert.equal(mappings[13].releaseVerified,true);
  const router=new MidiPadRouter();assert.equal(router.process([0xb0,40,127],mappings).down,true);
  assert.equal(router.process([0xb0,40,70],mappings),null);
  assert.equal(router.process([0xb0,40,0],mappings).down,false);
  router.clear();assert.equal(router.process([0xb0,40,0],mappings),null);
});

test('momentary learning requires the matching release and prevents duplicate or Q-Link assignments',()=>{
  for(const pad of [13,14]){
    const press=note(60),first=learnPadInput(press,{pad});assert.equal(first.status,'release');
    assert.equal(learnPadInput(note(61,false),{pad,pending:first.signal}).status,'ignore');
    assert.equal(learnPadInput(press,{pad,pending:first.signal}).status,'ignore');
    const complete=learnPadInput(note(60,false),{pad,pending:first.signal});assert.equal(complete.status,'learned');assert.equal(complete.releaseVerified,true);
  }
  assert.equal(learnPadInput(note(36),{pad:1}).status,'learned');
  assert.equal(learnPadInput(note(36),{pad:2,profile:{1:note(36)}}).status,'duplicate');
  assert.equal(learnPadInput(note(36),{pad:1,profile:{1:note(36)}}).status,'learned');
  const cc=padMidiSignal([0xb0,14,127]);assert.equal(learnPadInput(cc,{pad:3,reserved:[cc]}).status,'reserved');
  const pending=learnPadInput(cc,{pad:14});assert.equal(learnPadInput(padMidiSignal([0xb0,14,0]),{pad:14,pending:pending.signal}).releaseVerified,true);
});

function fakeDeck(){return {duration:120,currentTime:17,playing:false,pauses:0,plays:0,seeks:[],pause(){this.pauses++;this.playing=false;},seek(time){this.currentTime=time;this.seeks.push(time);},async play(){this.plays++;this.playing=true;}};}

test('pads1–12 place twelve evenly spaced needles while retaining transport state',()=>{
  const deck=fakeDeck(),pads=new PadTransport(deck);assert.deepEqual(MPC_PAD_ORDER,[13,14,15,16,9,10,11,12,5,6,7,8,1,2,3,4]);
  for(let pad=1;pad<=12;pad++){pads.press(pad);assert.equal(deck.currentTime,(pad-1)*10);assert.equal(deck.playing,false);}
  assert.equal(deck.plays,0);assert.equal(deck.pauses,0);deck.playing=true;pads.press(1);assert.equal(deck.playing,true);
});

test('random and needle gates start immediately, only the current gate release stops, and stop/toggle override holds',()=>{
  const deck=fakeDeck();let toggles=0,stops=0;const pads=new PadTransport(deck,{random:()=>.25,onToggle:()=>toggles++,onStop:()=>stops++});
  pads.press(13);assert.equal(deck.currentTime,30);assert.equal(deck.playing,true);
  pads.press(14);assert.equal(deck.currentTime,30);pads.release(13);assert.equal(deck.playing,true);
  pads.release(14);assert.equal(deck.playing,false);assert.equal(stops,1);
  pads.press(14);pads.press(15);assert.equal(deck.playing,false);assert.equal(pads.gate,null);
  pads.press(13);pads.press(16);assert.equal(toggles,1);assert.equal(pads.gate,null);const previous=stops;pads.release(13);assert.equal(stops,previous);
});

test('source loading blocks audition, emergency stop still works, and disconnect cancels a held pad only',()=>{
  const deck=fakeDeck();let unavailable=0;const pads=new PadTransport(deck,{ready:()=>false,onUnavailable:()=>unavailable++});
  pads.press(13);assert.equal(unavailable,1);assert.equal(deck.plays,0);deck.playing=true;pads.press(15);assert.equal(deck.playing,false);
  pads.ready=()=>true;pads.press(14);pads.cancelHold();assert.equal(deck.playing,false);
  deck.playing=true;pads.cancelHold();assert.equal(deck.playing,true);
});


test('needle callbacks see the new position after seeking and can cancel a pending stop before seeking',()=>{
  const deck=fakeDeck(),events=[];const pads=new PadTransport(deck,{beforeSeek:()=>events.push(['before',deck.currentTime]),onSeek:time=>events.push(['after',deck.currentTime,time])});
  pads.press(4);assert.deepEqual(events,[['before',17],['after',30,30]]);
});
