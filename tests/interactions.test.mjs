import test from 'node:test';
import assert from 'node:assert/strict';
import {shortcutAction, ShuffleCrate} from '../interactions.js';

const key = (value, extra = {}) => ({key: value, ...extra});
const records = (...ids) => ids.map(id => ({id, title: id}));
const button = {tagName: 'BUTTON', closest: () => null};

test('Space and random work while sleeves and other app buttons retain focus', () => {
  assert.equal(shortcutAction(key(' ', {code: 'Space', target: button})), 'toggle');
  assert.equal(shortcutAction(key('R', {target: button})), 'random');
  assert.equal(shortcutAction(key('m', {target: button})), 'mark');
  assert.equal(shortcutAction(key('ArrowLeft', {target: button})), 'back');
  assert.equal(shortcutAction(key('ArrowRight', {target: button})), 'forward');
});

test('typing and native form controls never become listening shortcuts', () => {
  for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
    for (const value of ['r', ' ', 'm', 'ArrowLeft', '0', '4', '9']) {
      assert.equal(shortcutAction(key(value, {target: {tagName}})), null);
    }
  }
  const editableChild = {closest: selector => selector.includes('contenteditable') ? {} : null};
  assert.equal(shortcutAction(key('r', {target: editableChild})), null);
  assert.equal(shortcutAction(key('r', {target: {isContentEditable: true}})), null);
});

test('number keys jump to tenths, including zero for the beginning and numpad digits', () => {
  for (let digit=0;digit<10;digit++) {
    assert.equal(shortcutAction(key(String(digit),{target:button})),`jump:${digit}`);
    assert.equal(shortcutAction(key(String(digit),{code:`Numpad${digit}`,target:button})),`jump:${digit}`);
  }
  for (const property of ['defaultPrevented','repeat','isComposing','ctrlKey','metaKey','altKey','shiftKey']) {
    assert.equal(shortcutAction(key('3',{target:button,[property]:true})),null);
  }
  assert.equal(shortcutAction(key('!')),null);
});

test('handled, held, composing, and modified keys are ignored', () => {
  for (const property of ['defaultPrevented', 'repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) {
    for (const value of [' ', 'r']) assert.equal(shortcutAction(key(value, {[property]: true})), null);
  }
  assert.equal(shortcutAction(key('Escape')), null);
  assert.equal(shortcutAction(null), null);
});

test('arrow keys retain slider behavior while Space can still operate the deck', () => {
  const sliderChild = {closest: selector => selector === '[role="slider"]' ? {} : null};
  assert.equal(shortcutAction(key('ArrowLeft', {target: sliderChild})), null);
  assert.equal(shortcutAction(key('ArrowRight', {target: sliderChild})), null);
  assert.equal(shortcutAction(key(' ', {target: sliderChild})), 'toggle');
});

test('native pitch and position ranges allow listening shortcuts but retain fader navigation', () => {
  const range = {tagName: 'INPUT', type: 'range', closest: () => null};
  assert.equal(shortcutAction(key(' ', {code: 'Space', target: range})), 'toggle');
  assert.equal(shortcutAction(key('R', {target: range})), 'random');
  for (const value of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown']) {
    assert.equal(shortcutAction(key(value, {target: range})), null);
  }
  for (const property of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(shortcutAction(key(' ', {target: range, [property]: true})), null);
  }
  const descendant = {closest: selector => selector === 'input[type="range"]' ? {} : null};
  assert.equal(shortcutAction(key('r', {target: descendant})), 'random');
  assert.equal(shortcutAction(key('ArrowRight', {target: descendant})), null);
});

test('other native input types remain protected', () => {
  for (const type of ['search', 'text', 'file', 'checkbox', 'number']) {
    for (const value of [' ', 'r']) {
      assert.equal(shortcutAction(key(value, {target: {tagName: 'INPUT', type}})), null);
    }
  }
});

test('shuffle draws each record once per cycle and avoids the current record', () => {
  const shuffle = new ShuffleCrate(() => .6), pool = records('a', 'b', 'c', 'd');
  let current = 'a';
  for (let cycle = 0; cycle < 5; cycle++) {
    const drawn = [];
    for (let index = 0; index < pool.length; index++) {
      const next = shuffle.next(pool, current);
      assert.notEqual(next.id, current);
      drawn.push(next.id); current = next.id;
    }
    assert.equal(new Set(drawn).size, pool.length);
  }
});

test('membership changes reset the bag and removed records never leak into results', () => {
  const shuffle = new ShuffleCrate(() => .9);
  shuffle.next(records('a', 'b', 'c'), 'a');
  let current = 'c';
  const drawn = [];
  for (let index = 0; index < 3; index++) {
    const next = shuffle.next(records('c', 'd', 'e'), current);
    drawn.push(next.id); current = next.id;
  }
  assert.deepEqual(new Set(drawn), new Set(['c', 'd', 'e']));
});

test('reordering a view keeps the bag and returns the latest record metadata', () => {
  const shuffle = new ShuffleCrate(() => .99);
  assert.equal(shuffle.next(records('a', 'b', 'c'), 'a').id, 'b');
  const updated = [{id: 'c', title: 'Updated'}, {id: 'b'}, {id: 'a'}];
  assert.equal(shuffle.next(updated, 'b').id, 'a');
  assert.equal(shuffle.next(updated, 'a').title, 'Updated');
});

test('empty and current-only crates have no alternative, and duplicate IDs are one record', () => {
  const shuffle = new ShuffleCrate(() => .5);
  assert.equal(shuffle.next([], 'a'), null);
  assert.equal(shuffle.next(records('a'), 'a'), null);
  assert.equal(shuffle.next(records('b'), 'a').id, 'b');
  assert.equal(shuffle.next(records('a', 'a'), 'a'), null);
  assert.equal(shuffle.next(records('a', 'a', 'b'), 'a').id, 'b');
});

test('manually selecting the last bag entry still permits another record', () => {
  const shuffle = new ShuffleCrate(() => .99);
  const pool = records('a', 'b', 'c');
  assert.equal(shuffle.next(pool, 'a').id, 'b');
  assert.equal(shuffle.next(pool, 'b').id, 'a');
  assert.notEqual(shuffle.next(pool, 'c').id, 'c');
});


test('native disclosures and explicit library/recovery regions keep their own keyboard actions',()=>{
  for(const value of [' ','r','m','1']){
    assert.equal(shortcutAction(key(value,{target:{tagName:'SUMMARY'}})),null);
    const summaryChild={closest:selector=>selector.includes('summary')?{}:null};
    assert.equal(shortcutAction(key(value,{target:summaryChild})),null);
    const recoveryButton={tagName:'BUTTON',closest:selector=>selector.includes('data-listening-shortcuts')?{}:null};
    assert.equal(shortcutAction(key(value,{target:recoveryButton})),null);
  }
  assert.equal(shortcutAction(key(' ',{target:button})),'toggle');
});
