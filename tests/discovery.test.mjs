import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryTray, filterRecords, shortcutAction} from '../interactions.js';

const records=Array.from({length:23},(_,index)=>({id:String(index),artist:`Artist ${index}`,title:`Record ${index}`,channel:`Collector ${index}`,genre:index%2?'Soul':'Jazz',year:1960+index}));

test('discovery trays are unique, bounded to ten and exhaust the pool before repeating',()=>{
  const tray=new DiscoveryTray([],()=>.4),a=tray.draw(records),b=tray.draw(records),c=tray.draw(records);
  assert.equal(a.length,10);assert.equal(b.length,10);assert.equal(c.length,3);
  assert.equal(new Set([...a,...b,...c].map(record=>record.id)).size,23);
  const d=tray.draw(records);assert.equal(d.length,10);
  assert.ok(d.every(record=>!c.some(previous=>previous.id===record.id)));
  assert.equal(records.length,23);
});
test('small and duplicate pools never create duplicate or fabricated records',()=>{
  const tray=new DiscoveryTray();assert.deepEqual(tray.draw([]),[]);
  assert.equal(tray.draw([records[0],records[0]]).length,1);
  assert.deepEqual(tray.draw([records[0]]),[records[0]]);
});
test('search covers artist, record and channel with intersecting genre and year filters',()=>{
  assert.deepEqual(filterRecords(records,{query:'collector 3'}),[records[3]]);
  assert.deepEqual(filterRecords(records,{query:'ARTIST 3',genre:'Soul',year:'1960'}),[records[3]]);
  assert.deepEqual(filterRecords(records,{query:'Record 3',genre:'Jazz'}),[]);
  assert.deepEqual(filterRecords([{...records[0],year:null}],{year:'unknown'}).length,1);
  assert.equal(filterRecords([{...records[0],year:2026}],{year:'2000'}).length,1);
  assert.equal(filterRecords([{...records[0],genre:'',genres:['Soul','Jazz']}],{genre:'Soul'}).length,1);
});
test('saved discovery history survives reconstruction without repeating the last tray',()=>{
  const tray=new DiscoveryTray([],()=>.2),first=tray.draw(records);
  const restored=new DiscoveryTray([...tray.seen],()=>.2),next=restored.draw(records);
  assert.ok(next.every(record=>!first.some(previous=>previous.id===record.id)));
});
test('D renews discoveries while typing, modifiers and held-key repeats retain their own behavior',()=>{
  assert.equal(shortcutAction({key:'d'}),'dig');
  assert.equal(shortcutAction({key:'D'}),'dig');
  assert.equal(shortcutAction({key:'d',target:{tagName:'INPUT'}}),null);
  assert.equal(shortcutAction({key:'d',ctrlKey:true}),null);
  assert.equal(shortcutAction({key:'d',repeat:true}),null);
});
