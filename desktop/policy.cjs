const {URL}=require('node:url');
function trustedFrame(frame,origin){try{return !!frame&&!frame.parent&&new URL(frame.url).origin===origin;}catch{return false;}}
function externalURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function libraryState(value){
  if(typeof value!=='string'||Buffer.byteLength(value)>8*1024*1024)throw new Error('Library backup is too large. Export your crate to keep it.');
  const state=JSON.parse(value);if(!state||typeof state!=='object'||Array.isArray(state)||!Array.isArray(state.records))throw new Error('This is not a Record Room library.');
  return JSON.stringify(state);
}
module.exports={trustedFrame,externalURL,libraryState};
