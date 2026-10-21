import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {trustedFrame,externalURL,libraryState}=createRequire(import.meta.url)('../desktop/policy.cjs');
test('native folder and library bridge accepts only the app main frame',()=>{
  const origin='http://127.0.0.1:18771';
  assert.equal(trustedFrame({url:origin+'/',parent:null},origin),true);
  for(const frame of [null,{url:'https://youtube.com',parent:null},{url:origin,parent:{}},{url:origin+'.evil.test/',parent:null},{url:'not a url'}])assert.equal(trustedFrame(frame,origin),false);
});
test('external links never invoke local protocols or credential-bearing URLs',()=>{
  assert.equal(externalURL('https://www.youtube.com/watch?v=abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
  for(const url of ['file:///C:/Windows','javascript:alert(1)','shell:AppsFolder','https://user:password@example.com','http://example.com'])assert.equal(externalURL(url),null);
});
test('persistent desktop library requires valid bounded Record Room data',()=>{
  const state={records:[],marks:{},padProfiles:{'USB Midi':{}}};assert.deepEqual(JSON.parse(libraryState(JSON.stringify(state))),state);
  for(const input of ['[]','null','{}','broken',' '.repeat(8*1024*1024+1)])assert.throws(()=>libraryState(input));
});
