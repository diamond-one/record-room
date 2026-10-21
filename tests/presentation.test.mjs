import test from 'node:test';
import assert from 'node:assert/strict';
import {GROOVES,rateToFader,faderToRate,faderArtworkOffset,youtubeProblem,downloadProblem,stepStreamRate,explainDownloadError,orderedDownloads} from '../presentation.js';
test('stream fader centers normal speed and spans the supported rates in either direction',()=>{
  for(const rates of [[.25,.5,.75,1,1.25,1.5,1.75,2],[.5,1,1.5],[1],[1,1.25]]){
    assert.equal(rateToFader(1,rates),0);assert.equal(faderToRate(0,rates),1);
    assert.equal(faderToRate(-8,rates),Math.min(...rates));assert.equal(faderToRate(8,rates),Math.max(...rates));
    for(const rate of rates)assert.equal(faderToRate(rateToFader(rate,rates),rates),rate);
  }
});
test('thumb reaches both track ends without crossing them, with a centered neutral',()=>{
  assert.equal(766.5+faderArtworkOffset(8)-33.5,602);
  assert.equal(766.5+faderArtworkOffset(-8)+33.5,965);
  assert.equal(faderArtworkOffset(0),17);
  assert.equal(faderArtworkOffset(-800),faderArtworkOffset(-8));
  assert.ok(GROOVES.inner > .23,'music stops outside the uncut runout');
});
test('unavailable videos are distinguished from embed restrictions and download/network failures',()=>{
  assert.equal(youtubeProblem(100),'Unavailable on YouTube');assert.equal(youtubeProblem(150),'YouTube only');
  assert.equal(downloadProblem({state:'failed',error:'Video unavailable'}).code,100);
  assert.equal(downloadProblem({state:'failed',error:'HTTP Error 403: Forbidden'}).code,'download');
  assert.equal(downloadProblem({state:'ready'}),null);
});

test('stream arrow navigation moves by supported rates without snapping back at the neutral detent',()=>{
  const rates=[.25,.5,.75,1,1.25,1.5,1.75,2];
  assert.equal(stepStreamRate(1,rates,1),1.25);assert.equal(stepStreamRate(1,rates,-1),.75);
  let rate=1;for(let i=0;i<8;i++)rate=stepStreamRate(rate,rates,1);assert.equal(rate,2);
  for(let i=0;i<10;i++)rate=stepStreamRate(rate,rates,-1);assert.equal(rate,.25);
  assert.equal(stepStreamRate(1,[1],1),1);
});


test('download recovery distinguishes removed uploads, access blocks and interrupted connections',()=>{
  assert.match(explainDownloadError('Video unavailable'),/upload is unavailable/);
  assert.match(explainDownloadError('HTTP Error 403: Forbidden'),/blocked this download/);
  assert.doesNotMatch(explainDownloadError('HTTP Error 403: Forbidden'),/upload is unavailable/);
  assert.match(explainDownloadError('Connection timed out'),/internet connection/);
  assert.match(explainDownloadError('ffmpeg is not installed'),/Setup downloads/);
  assert.match(explainDownloadError('Interrupted'),/Retry to finish/);
  assert.match(explainDownloadError('Unexpected failure'),/Retry the download/);
});

test('queue filters expose failures immediately and preserve stable source ordering without mutation',()=>{
  const jobs=[{id:'saved',state:'ready'},{id:'fail-a',state:'failed'},{id:'queued',state:'queued'},{id:'fail-b',state:'failed'},{id:'working',state:'downloading'},{id:'cancel',state:'cancelled'}];
  const original=JSON.stringify(jobs);
  assert.deepEqual(orderedDownloads(jobs).map(j=>j.id),['working','queued','fail-a','fail-b','cancel','saved']);
  assert.deepEqual(orderedDownloads(jobs,'attention').map(j=>j.id),['fail-a','fail-b']);
  assert.deepEqual(orderedDownloads(jobs,'active').map(j=>j.id),['working','queued']);
  assert.deepEqual(orderedDownloads(jobs,'ready').map(j=>j.id),['saved']);
  assert.deepEqual(orderedDownloads([],'attention'),[]);
  assert.equal(JSON.stringify(jobs),original);
});
