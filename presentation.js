/** Shared physical presentation: fractions of the record diameter. */
export const GROOVES = Object.freeze({outer: .487, inner: .235});
const bound = value => Math.max(-8, Math.min(8, Number(value) || 0));
export function rateToFader(rate, rates) {
  const low = Math.min(1, ...rates), high = Math.max(1, ...rates);
  return bound(rate >= 1 ? (high > 1 ? (rate - 1) / (high - 1) * 8 : 0) : (low < 1 ? (rate - 1) / (1 - low) * 8 : 0));
}
export function faderToRate(value, rates) {
  const position = bound(value), low = Math.min(1, ...rates), high = Math.max(1, ...rates);
  const requested = 1 + position / 8 * (position >= 0 ? high - 1 : 1 - low);
  return rates.reduce((best, rate) => Math.abs(rate - requested) < Math.abs(best - requested) ? rate : best, rates[0] ?? 1);
}
// Track source y=602..965; 67px thumb. Neutral artwork center y=766.5.
export function faderArtworkOffset(value) { return 17 - bound(value) / 8 * 148; }
export function youtubeProblem(code) {
  return code === 'download' ? 'Download needs attention' : code === 'autoplay' ? 'Click YouTube Play' : code === 100 ? 'Unavailable on YouTube' : [101,150].includes(code) ? 'YouTube only' : 'Playback issue';
}

export function downloadProblem(job) {
  if(job?.state !== 'failed') return null;
  return /video (?:is )?unavailable|private video|video has been removed|video (?:has been )?deleted/i.test(job.error || '')
    ? {code:100,message:job.error} : {code:'download',message:job.error || 'Download failed; try YouTube or retry.'};
}

export function stepStreamRate(current, rates, direction) {
  if(!rates.length)return 1;
  const nearest=rates.reduce((best,rate)=>Math.abs(rate-current)<Math.abs(best-current)?rate:best,rates[0]);
  return rates[Math.max(0,Math.min(rates.length-1,rates.indexOf(nearest)+direction))];
}

/** Queue presentation keeps failures actionable without implying every access error is a removed video. */
export function explainDownloadError(error='') {
  if(/video (?:is )?unavailable|private video|video has been removed|video (?:has been )?deleted/i.test(error))return 'This upload is unavailable. Open YouTube to check the source, or attach a local recording.';
  if(/403|forbidden|429|too many requests|sign in|bot|members.only|age.restricted/i.test(error))return 'YouTube blocked this download. Try again later or open the video on YouTube.';
  if(/ffmpeg|yt.dlp.*missing|converter|not installed/i.test(error))return 'The audio downloader or converter needs setup. Run Setup downloads, then retry.';
  if(/timed? out|connection|network|resolve|offline/i.test(error))return 'The connection was interrupted. Check your internet connection and retry.';
  if(/interrupted/i.test(error))return 'This download was interrupted. Retry to finish saving the audio.';
  return 'The audio could not be saved. Retry the download or open its YouTube source.';
}
export function orderedDownloads(jobs,filter='all') {
  const active=new Set(['downloading','converting','queued']);
  const rank={downloading:0,converting:0,queued:1,failed:2,cancelled:3,ready:4};
  return jobs.filter(job=>filter==='all'||(filter==='attention'?job.state==='failed':filter==='active'?active.has(job.state):job.state==='ready'))
    .map((job,index)=>({job,index})).sort((a,b)=>(rank[a.job.state]??5)-(rank[b.job.state]??5)||a.index-b.index).map(x=>x.job);
}
