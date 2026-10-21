import {DeckAudio, normalizeCrate as normalizeInput, formatTime, analyseGrooves, scanTarget, pitchFromCC, Pickup} from './engine.js';
import {needleAngle,advancePlatter} from './mechanics.js';
import {shortcutAction, ShuffleCrate, DiscoveryTray, filterRecords, MPC_PAD_ORDER, padDescription, padMidiSignal, samePadSignal, cleanPadMappings, MidiPadRouter, PadTransport, learnPadInput} from './interactions.js';
import {GROOVES, rateToFader, faderToRate, faderArtworkOffset, youtubeProblem, downloadProblem, stepStreamRate, explainDownloadError, orderedDownloads} from './presentation.js';
import {drawMatrix} from './matrix.js';
import {initLibraryControls} from './library.js';

const $ = id => document.getElementById(id);
const deck = new DeckAudio();
const jumpButtons = [...document.querySelectorAll('[data-record-jump]')];
const STORAGE = 'record-room.v1';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let stored = {};
try { stored = JSON.parse(window.recordRoom?.initialLibrary || localStorage.getItem(STORAGE) || '{}'); } catch { /* The original import remains available. */ }
const excludedIds = new Set(Array.isArray(stored.excludedIds) ? stored.excludedIds.filter(id=>typeof id==='string'&&/^[\w-]{11}$/.test(id)) : []);
function normalizeCrate(input){return normalizeInput(input).filter(record=>!excludedIds.has(record.youtubeId));}
let records = [], selected = null, view = 'all', loading = 0, localFiles = new Map();
let libraryTab = stored.libraryTab === 'dig' ? 'dig' : 'crate', catalogue = [], digBatch = [], importTarget = 'crate';
const filters = {crate:{query:'',genre:'',year:''},dig:{query:'',genre:'',year:''}};
for(const tab of ['crate','dig'])for(const key of ['query','genre','year'])if(typeof stored.libraryFilters?.[tab]?.[key]==='string')filters[tab][key]=stored.libraryFilters[tab][key];
const digTray = new DiscoveryTray(Array.isArray(stored.digSeen) ? stored.digSeen.slice(-10000) : []);
let liveCatalogue=[],discoveryState={version:-1,total:0,running:false},discoveryTimer=null,discoveryStarted=false;
let marks = stored.marks && typeof stored.marks === 'object' ? stored.marks : {};
let heard = new Set(Array.isArray(stored.heard) ? stored.heard : []);
let mappings = stored.mappings && typeof stored.mappings === 'object' ? stored.mappings : {};
const padProfiles=Object.create(null);
if(stored.padProfiles&&typeof stored.padProfiles==='object')for(const [name,profile] of Object.entries(stored.padProfiles))padProfiles[name]=cleanPadMappings(profile);
let padLearning=null,padLearnAll=false,padLearnPending=null,padLearnDraft=null;
const padRouter=new MidiPadRouter();
const padTransport=new PadTransport(deck,{
  ready:()=>!!selected&&!sourceLoading&&!selectionFailed,
  onStart:()=>{clearTimeout(seekTimer);wantedPlaying=true;resumeAfterCue=false;needleLifted=false;$('cue-button').setAttribute('aria-pressed','false');$('deck').classList.remove('is-lifted');},
  onStop:()=>{clearTimeout(seekTimer);wantedPlaying=false;resumeAfterCue=false;renderTransport();},
  beforeSeek:()=>{clearTimeout(seekTimer);if(!playingIntent()&&deck.motorStopping)deck.pause();},
  onSeek:time=>{fineAnchor=time;resetPickup();},
  onToggle:()=>{void togglePlay();},
  onUnavailable:()=>status('Wait for a playable record to load before using the pads.'),
  onError:error=>status(error.message,true)
});
let scanMode = stored.scanMode === 'fine' ? 'fine' : 'whole', fineAnchor = 0;
let needleLifted = false, resumeAfterCue = false, rpm = 33, grooveData = null;
let seeking = false, dragResume = false, dragTime = 0, activeDrag = null, seekTimer = null;
let midiPort = null, midiConnection = null, midiEvents = null, webMidi = null, learning = null;
let animationAngle = 0, previousFrame = performance.now(), lastInterfaceTick = 0, lastDuration = 0;
let pendingInitialSeek = null;
let selectionFailed = false;
let sourceLoading = false, wantedPlaying = false, spaceHandled = false, lastRatesKey = '';
let motorFeel = ['quick', 'natural', 'heavy'].includes(stored.motorFeel) ? stored.motorFeel : 'natural';
const randomCrate = new ShuffleCrate();
let downloadState = {jobs:[],tools:{ready:false},active:0}, downloadAvailable = false, downloadListKey = '';
let lastDownloadFailures='';
const streamOnly = new Set();
let streamProblems = stored.streamProblems && typeof stored.streamProblems === 'object' ? stored.streamProblems : {};
let lastPawn = null, openRecordMenu = null, lastRemovedMoment = null;
let downloadFilter='all';
let downloadReturnScroll=0;
const downloadFilters=[...document.querySelectorAll('[data-download-filter]')];
const narrowLayout=matchMedia('(max-width:850px)');
function placeTrackIdentity(){
  const identity=$('track-identity');
  if(narrowLayout.matches)document.querySelector('.turntable').after(identity);
  else $('display-module').append(identity);
}
narrowLayout.addEventListener('change',placeTrackIdentity);placeTrackIdentity();
const libraryUI=initLibraryControls({
  closeTools:()=>{$('crate-tools').open=false;showDownloads(false);$('midi-panel').hidden=true;$('midi-button').setAttribute('aria-expanded','false');},
  onPlay:record=>{void deck.preparePlayback().catch(()=>{});void selectRecord(normalizeCrate([record])[0],true);},
  onToggle:()=>{void togglePlay();},
  onDiscovery:state=>{
    receiveExclusions(state.excludedIds);
    discoveryState=state;if(Array.isArray(state.records))liveCatalogue=normalizeCrate(state.records);
    if(libraryTab==='dig'){const valid=new Set(digPool().map(r=>r.id));digBatch=digBatch.filter(r=>valid.has(r.id));setOptions();if(!digBatch.length)renewDig(false);else renderCrate();}
    renderDiscoverySource();save();if(state.running)void loadDiscovery(false,false);
  }
});


const scanPickup = new Pickup(0), pitchPickup = new Pickup(64);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function paintStrobe() {
  const canvas=$('strobe-pattern'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,1200,1200);
  ctx.fillStyle='#202020';ctx.fillRect(0,0,1200,1200);
  for(let row=0;row<4;row++){
    const radius=583-row*12,count=180-row*6;
    for(let i=0;i<count;i++){
      const angle=i/count*Math.PI*2;
      ctx.save();ctx.translate(600+Math.cos(angle)*radius,600+Math.sin(angle)*radius);ctx.rotate(angle);
      ctx.beginPath();ctx.ellipse(0,0,3,5.5,0,0,Math.PI*2);ctx.fillStyle=row===2?'#fff':'#dedede';ctx.fill();
      ctx.restore();
    }
  }
}
paintStrobe();

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({records, catalogue, excludedIds:[...excludedIds], digRecords:digBatch, digIds:digBatch.map(r=>r.id), digSeen:[...digTray.seen].slice(-10000),libraryTab,libraryFilters:filters, marks, heard: [...heard], mappings, padProfiles, scanMode, motorFeel, streamProblems, selected: selected?.id,selectedRecord:selected}));
    if(window.recordRoom)window.recordRoom.saveLibrary(localStorage.getItem(STORAGE)).catch(()=>status('Your library could not be saved. Export your crate to keep these changes.',true));
  } catch { status('Browser storage is full or unavailable. Export your crate to keep these changes.', true); }
}
function displayTitle(record) { return record.trackTitle || record.title; }
function receiveExclusions(ids){
  if(!Array.isArray(ids))return;
  const before=excludedIds.size;
  for(const id of ids)if(typeof id==='string'&&/^[\w-]{11}$/.test(id))excludedIds.add(id);
  if(before===excludedIds.size)return;
  const keep=record=>!excludedIds.has(record.youtubeId);
  records=records.filter(keep);catalogue=catalogue.filter(keep);liveCatalogue=liveCatalogue.filter(keep);digBatch=digBatch.filter(keep);
  if(selected&&!keep(selected)){
    ++loading;clearTimeout(seekTimer);padTransport.cancelHold();deck.pause();selected=null;wantedPlaying=false;sourceLoading=false;
    updateSleeveDisplay(null);$('playback-recovery').hidden=true;
    for(const id of ['label-title','label-artist','label-meta','record-title','record-artist','record-year','dock-title'])$(id).textContent='';
  }
  save();setOptions();renderCrate();renderTransport();
}
async function excludeUnavailable(ids){
  receiveExclusions(ids);
  try{
    const response=await fetch('/api/collection/exclusions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
    if(!response.ok)throw new Error();
    receiveExclusions((await response.json()).excludedIds);
  }catch{status('Unavailable record hidden on this device. Reopen Record Room to sync its exclusion.',true);}
}
function renderDeckMembership(){
  const button=$('now-playing-save');button.disabled=!selected;
  const saved=!!selected&&records.some(record=>record.id===selected.id);
  button.setAttribute('aria-pressed',String(saved));
  button.setAttribute('aria-label',selected?`${saved?'Remove':'Add'} ${displayTitle(selected)} ${saved?'from':'to'} My Crate`:'Add to My Crate');
  button.title=saved?'Remove from My Crate':'Add to My Crate';
  button.querySelector('span').textContent=saved?'In My Crate':'Add to crate';
  button.querySelector('img').src=saved?'assets/crate-saved.png':'assets/crate-add.png';
}
function updateSleeveDisplay(record) {
  $('now-playing').hidden=!record;if(!record)return;
  const img=$('now-playing-image');img.classList.remove('failed');
  img.src=`https://i.ytimg.com/vi/${record.youtubeId}/hqdefault.jpg`;img.alt=`Source thumbnail for ${recordArtist(record)} — ${displayTitle(record)}`;
}
$('now-playing-image').addEventListener('error',event=>event.target.classList.add('failed'));
$('now-playing-save').addEventListener('click',()=>{if(selected)toggleCrate(selected,false);});
function recordArtist(record) { return record.artist || record.channel || 'Unknown artist'; }
function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function digPool(){return liveCatalogue.length?liveCatalogue:catalogue;}
function renderDiscoverySource(){
  const state=discoveryState;
  $('dig-source-summary').textContent=state.running?`Checking channels · ${state.checked||0}/${state.checkable??state.total}`:liveCatalogue.length?`Source: ${state.working||0} YouTube channels`:'Source: imported records';
  $('dig-source-message').textContent=liveCatalogue.length?`${liveCatalogue.length.toLocaleString()} records to discover. Manage your channels to add more.`:state.total?'Your channels are being checked. You can keep browsing meanwhile.':'Add a YouTube channel to start digging.';
  $('dig-channel-progress').hidden=!(state.running||state.error);
  $('dig-channel-progress').textContent=state.error||(state.running?'Checking channel feeds…':'');
  $('refresh-channels').disabled=!!state.running||!(state.checkable??state.total);
  $('refresh-channels').textContent=state.running?'Checking channels…':'Check channels';
  libraryUI.updateDiscovery(state);
}
async function loadDiscovery(start=false,refreshTray=true,force=false){
  clearTimeout(discoveryTimer);
  try{
    if(start){const response=await fetch('/api/discovery/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force})});if(!response.ok)throw new Error('Channel checking could not start. Try again later.');}
    const response=await fetch(`/api/discovery?version=${discoveryState.version}`);if(!response.ok)throw new Error('Channel discovery is unavailable. Restart Record Room to load the updated server.');
    const next=await response.json(),wasLive=liveCatalogue.length>0;
    receiveExclusions(next.excludedIds);
    if(Array.isArray(next.records))liveCatalogue=normalizeCrate(next.records);
    discoveryState=next;renderDiscoverySource();
    if(libraryTab==='dig'){setOptions();if(refreshTray&&liveCatalogue.length&&!wasLive)renewDig(false);else renderCrate();}
    if(next.running)discoveryTimer=setTimeout(()=>loadDiscovery(),3000);
  }catch(error){discoveryState.error=error.message;renderDiscoverySource();}
}
function setOptions() {
  const current = filters[libraryTab].genre;
  $('genre-filter').replaceChildren(new Option('Every genre', ''));
  [...new Set((libraryTab==='dig'?digPool():records).flatMap(r => [r.genre,...(Array.isArray(r.genres)?r.genres:[])]).filter(Boolean))].sort().forEach(g => $('genre-filter').add(new Option(g, g)));
  if(current&&! [...$('genre-filter').options].some(o=>o.value===current))$('genre-filter').add(new Option(current,current));
  if ([...$('genre-filter').options].some(o => o.value === current)) $('genre-filter').value = current;
}
function visibleRecords() {
  return libraryTab==='dig'?filterRecords(digBatch,filters.dig):filterRecords(records,filters.crate);
}
function changeLibraryTab(tab, draw=false){
  libraryTab=tab;
  for(const name of ['crate','dig']){const button=$('tab-'+name);button.setAttribute('aria-selected',String(tab===name));button.tabIndex=tab===name?0:-1;}
  $('library-panel').setAttribute('aria-labelledby','tab-'+tab);
  $('search').value=filters[tab].query;$('year-filter').value=filters[tab].year;
  $('search').setAttribute('aria-label',tab==='dig'?'Search discovery records':'Search your crate');
  $('dig-toolbar').hidden=tab!=='dig';$('dig-source').hidden=tab!=='dig';
  $('crate-surface').classList.toggle('is-dig',tab==='dig');
  setOptions();
  if(tab==='dig'&&(draw||!digBatch.length))renewDig(false);
  else renderCrate();
  save();
  if(tab==='dig'&&!discoveryStarted){discoveryStarted=true;void loadDiscovery(true);}
}
function renewDig(announce=true){
  digBatch=digTray.draw(filterRecords(digPool(),filters.dig));
  renderCrate();save();$('record-grid').scrollTop=0;
  if(announce)status(digBatch.length?`Fresh tray: ${digBatch.length} records. The record on the deck keeps its place.`:'No discovery records match. Clear a filter or import discovery records.');
}
function toggleCrate(record, focusGrid=true){
  if(excludedIds.has(record.youtubeId))return;
  const index=records.findIndex(r=>r.id===record.id), added=index<0;
  if(added)records.push({...record});else records.splice(index,1);
  setOptions();renderCrate();save();
  if(focusGrid){const control=[...$('record-grid').querySelectorAll('.crate-toggle')].find(button=>button.dataset.recordId===record.id);control?.focus({preventScroll:true});}
  status(`${added?'Added':'Removed'} ${displayTitle(record)} ${added?'to':'from'} My Crate.`);
}
function renderCrate() {
  renderDeckMembership();
  const filtered = visibleRecords();
  const crateScroll = $('record-grid').scrollTop;
  $('download-crate').disabled = !downloadAvailable || !filtered.length;
  $('download-crate').querySelector('span').textContent = libraryTab==='crate'&&filtered.length === records.length ? 'Download this crate' : `Download ${filtered.length} shown record${filtered.length===1?'':'s'}`;
  $('crate-count').textContent = libraryTab==='dig'?`${filtered.length} discovery records`:filtered.length === records.length ? `${records.length} records` : `${filtered.length} of ${records.length} records`;
  const matching=filterRecords(digPool(),filters.dig).length;
  $('dig-count').textContent=`${filtered.length} of ${matching} records`;
  $('keep-digging').disabled=!matching;
  const fragment = document.createDocumentFragment();
  filtered.forEach((r, index) => {
    const button = make('button', 'sleeve' + (selected?.id === r.id ? ' selected' : ''));
    button.type = 'button'; button.setAttribute('aria-label', `Put on ${recordArtist(r)} — ${displayTitle(r)}`);
    button.setAttribute('aria-pressed', String(selected?.id === r.id)); button.draggable = true;
    const art = make('span', 'sleeve-art');
    const img = make('img'); img.src = `https://i.ytimg.com/vi/${r.youtubeId}/hqdefault.jpg`; img.alt = ''; img.loading = index < 6 ? 'eager' : 'lazy'; img.referrerPolicy = 'strict-origin-when-cross-origin';
    img.addEventListener('error', () => img.classList.add('failed'));
    const fallback = make('span', 'sleeve-fallback'); fallback.append(make('span', '', recordArtist(r)), make('small', '', displayTitle(r)));
    art.append(img, fallback);
    if (selected?.id === r.id) art.append(make('span', 'on-deck-badge', 'On the deck'));
    else if (downloadState.jobs.some(j=>j.id===r.youtubeId&&j.state==='ready')) art.append(make('span','on-deck-badge','Downloaded'));
    button.append(art, make('span', 'sleeve-title', r.artist ? `${r.artist} — ${displayTitle(r)}` : r.title), make('span', 'sleeve-meta', [r.year, r.genre || (r.genreHint?`${r.genreHint} channel`:'')].filter(Boolean).join(' · ') || r.channel));
    button.addEventListener('click', () => {void deck.preparePlayback().catch(()=>{});void selectRecord(r, true);});
    button.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', r.id); event.dataTransfer.effectAllowed = 'copy'; });
    const item = make('div','sleeve-item'); item.append(button);
    if(libraryTab==='dig'){
      const saved=records.some(record=>record.id===r.id),toggle=make('button','crate-toggle');toggle.type='button';toggle.dataset.recordId=r.id;
      toggle.setAttribute('aria-pressed',String(saved));toggle.setAttribute('aria-label',`${saved?'Remove':'Add'} ${displayTitle(r)} ${saved?'from':'to'} My Crate`);toggle.title=saved?'In My Crate — click to remove':'Add to My Crate';
      const icon=make('img');icon.src=saved?'assets/crate-saved.png':'assets/crate-add.png';icon.alt='';toggle.append(icon);toggle.addEventListener('click',()=>toggleCrate(r));item.append(toggle);
    }
    const more = make('button','record-more'); more.type='button'; more.setAttribute('aria-label',`Record options for ${displayTitle(r)}`); more.setAttribute('aria-expanded','false'); more.setAttribute('aria-haspopup','menu');
    more.innerHTML='<svg aria-hidden="true"><use href="#i-more"/></svg>';
    const menu=make('div','record-menu'); menu.hidden=true; menu.setAttribute('role','menu'); menu.setAttribute('aria-label',`Options for ${displayTitle(r)}`);
    const youtube=make('a','','YouTube'); youtube.href=`https://www.youtube.com/watch?v=${r.youtubeId}`; youtube.target='_blank'; youtube.rel='noopener noreferrer'; youtube.setAttribute('role','menuitem');
    const pawn=make('button','','Pawn'); pawn.type='button'; pawn.setAttribute('role','menuitem'); pawn.title='Remove from crate; keeps downloaded audio';
    pawn.disabled=!records.some(record=>record.id===r.id);
    const close=()=>{menu.hidden=true;more.setAttribute('aria-expanded','false');if(openRecordMenu?.menu===menu)openRecordMenu=null;};
    more.addEventListener('click',()=>{const opening=menu.hidden;closeRecordMenu();if(opening){menu.hidden=false;more.setAttribute('aria-expanded','true');const box=more.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(innerWidth-232,box.right-224))}px`;menu.style.top=`${Math.max(8,Math.min(innerHeight-200,box.bottom+4))}px`;openRecordMenu={menu,more,close};youtube.focus();}});
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();more.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();(event.key==='Home'?youtube:event.key==='End'?pawn:document.activeElement===youtube?pawn:youtube).focus();}});
    menu.addEventListener('focusout',event=>{if(!item.contains(event.relatedTarget))close();});
    youtube.addEventListener('click',close);pawn.addEventListener('click',()=>pawnRecord(r));
    const pawnHelp=make('p','pawn-help','Pawn removes this record from the crate. Audio and moments stay saved.');menu.append(youtube,pawn,pawnHelp);item.append(more,menu);
    const downloadIssue=downloadProblem(downloadState.jobs.find(j=>j.id===r.youtubeId));
    const problem=downloadIssue?.code===100?downloadIssue:streamProblems[r.id] || downloadIssue, downloaded=downloadState.jobs.some(j=>j.id===r.youtubeId&&j.state==='ready');
    if(problem&&!downloaded){const badge=make('span','record-problem',youtubeProblem(problem.code));badge.title=problem.message;item.append(badge);}
    fragment.append(item);
  });
  if (!filtered.length){
    const starting=libraryTab==='crate'?!records.length:!digPool().length;
    fragment.append(make('p','empty-crate',starting?(libraryTab==='crate'?'Your crate starts here. Import favourites, or find records in Dig.':'Add a YouTube channel to start digging. Preview its records and keep the ones you like.'):'No records match these filters. Try another genre or clear your search.'));
    if(starting){const actions=make('div','empty-crate-actions'),button=make('button','',libraryTab==='crate'?'Import crate':'Add channel');button.type='button';button.addEventListener('click',()=>$(libraryTab==='crate'?'import-button':'manage-sources-menu').click());actions.append(button);if(libraryTab==='crate'){const dig=make('button','','Explore Dig');dig.type='button';dig.addEventListener('click',()=>changeLibraryTab('dig'));actions.append(dig);}fragment.append(actions);}
  }
  openRecordMenu=null;
  $('record-grid').replaceChildren(fragment);
  $('record-grid').scrollTop = crateScroll;
  $('crate-end').textContent = libraryTab==='dig'?'White crate: add. Red crate: saved. Click again to remove.':filtered.length?'Your favourites, ready to rediscover.':'My Crate is empty or filtered. Add records from Dig, or import a crate.';
}
function closeRecordMenu(){openRecordMenu?.close();}
document.addEventListener('scroll',closeRecordMenu,true);
document.addEventListener('pointerdown',event=>{if(openRecordMenu&&!openRecordMenu.menu.contains(event.target)&&!openRecordMenu.more.contains(event.target))closeRecordMenu();});
function pawnRecord(record){
  const index=records.findIndex(r=>r.id===record.id);if(index<0)return;
  lastPawn={record,index};records.splice(index,1);closeRecordMenu();setOptions();renderCrate();save();
  $('pawn-message').textContent=`Pawned ${displayTitle(record)}. Removed from your crate.`;$('pawn-notice').hidden=false;$('undo-pawn').focus();
  status('Removed from crate. Downloaded audio and saved moments are kept; Undo puts the record back.');
}
$('undo-pawn').addEventListener('click',()=>{if(!lastPawn)return;records.splice(Math.min(lastPawn.index,records.length),0,lastPawn.record);lastPawn=null;$('pawn-notice').hidden=true;setOptions();renderCrate();save();$('search').focus();});
function renderMarks() {
  const fragment = document.createDocumentFragment();
  for (const [index, point] of (marks[selected?.id] || []).entries()) {
    const chip = make('span', 'moment');
    const go = make('button', '', formatTime(point.time)); go.title = point.note || 'Play this saved moment';go.dataset.momentTime=String(point.time);
    go.addEventListener('click', () => seekTo(point.time, true));
    const remove = make('button', 'remove-moment'); remove.setAttribute('aria-label', `Remove moment at ${formatTime(point.time)}`);
    remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    remove.addEventListener('click', () => { const recordId=selected.id;lastRemovedMoment={recordId,point:marks[recordId].splice(index,1)[0]};$('moment-undo-message').textContent=`Removed ${formatTime(point.time)}.`;$('moment-undo').hidden=false;renderMarks();renderCrate();drawGrooves();save();$('undo-moment').focus(); });
    chip.append(go, remove); fragment.append(chip);
  }
  $('moments').replaceChildren(fragment);
  $('moments-help').hidden = !!marks[selected?.id]?.length;
}
$('undo-moment').addEventListener('click',()=>{if(!lastRemovedMoment)return;const {recordId,point}=lastRemovedMoment;const points=marks[recordId]||=[];if(!points.some(m=>m.time===point.time))points.push(point);points.sort((a,b)=>a.time-b.time);lastRemovedMoment=null;$('moment-undo').hidden=true;renderMarks();renderCrate();drawGrooves();save();const restored=recordId===selected?.id?[...$('moments').querySelectorAll('[data-moment-time]')].find(button=>Number(button.dataset.momentTime)===point.time):null;(restored||$('keep-button')).focus();status(`Restored ${formatTime(point.time)}.`);});
function keepMoment() {
  if (!selected || !deck.duration) { status('Load a playable record before keeping a moment.'); return; }
  const time = Math.min(deck.currentTime, deck.duration);
  const points = marks[selected.id] ||= [];
  if (points.some(p => Math.abs(p.time - time) < .5)) { status('This moment is already in your finds.'); return; }
  points.push({time: Math.round(time * 100) / 100, note: ''}); points.sort((a, b) => a.time - b.time);
  save(); renderMarks(); renderCrate(); status(`Kept ${formatTime(time)}. Your moment is saved beside the transport.`);
}
function resetPickup() {
  const d = deck.duration;
  let target = d ? deck.currentTime / d * 127 : 0;
  if (scanMode === 'fine') {
    const low = scanTarget(0, d, 'fine', fineAnchor), high = scanTarget(127, d, 'fine', fineAnchor);
    target = high > low ? (deck.currentTime - low) / (high - low) * 127 : 0;
  }
  scanPickup.reset(target);
  const basePitch = deck.rate / (rpm === 45 ? 45 / (100 / 3) : 1);
  if (deck.isLocal) pitchPickup.reset(basePitch <= 1 ? (basePitch - .92) / .08 * 63 : 65 + (basePitch - 1) / .08 * 62);
  else { const rates = deck.availableRates; pitchPickup.reset(rates.length > 1 ? rates.indexOf(deck.rate) / (rates.length - 1) * 127 : 64); }
}
function drawGrooves() {
  const canvas = $('grooves'), ctx = canvas.getContext('2d'), size = canvas.width, center = size / 2;
  ctx.clearRect(0, 0, size, size);
  const total = 250, outer = size * GROOVES.outer, inner = size * GROOVES.inner;
  for (let i = 0; i < total; i++) {
    const progress = i / (total - 1), radius = outer - progress * (outer - inner);
    const energy = grooveData ? grooveData[Math.min(grooveData.length - 1, Math.floor(progress * grooveData.length))] : null;
    ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = energy === null ? `rgba(225,231,219,${i % 4 === 0 ? .14 : .055})` : `rgba(230,236,214,${.035 + energy * .23})`;
    ctx.lineWidth = energy === null ? (i % 4 === 0 ? 1 : .6) : .4 + energy * 1.7;
    ctx.stroke();
    if (energy !== null && energy < .025) { ctx.beginPath(); ctx.arc(center, center, radius - .9, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(7,14,9,.38)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  for (const point of marks[selected?.id] || []) {
    if (!deck.duration || point.time > deck.duration) continue;
    const radius = outer - clamp(point.time / deck.duration, 0, 1) * (outer - inner);
    ctx.beginPath(); ctx.arc(center, center, radius, -.65, -.38); ctx.strokeStyle = '#cadb88'; ctx.lineWidth = 3; ctx.stroke();
  }
}
function setSourceAppearance() {
  $('source-details').open=!deck.isLocal;
  $('local-source').hidden = !deck.isLocal;
  $('local-source').parentElement.classList.toggle('has-local',deck.isLocal);
  const yt = $('youtube-player'); if (yt) yt.hidden = deck.isLocal;
  $('source-kind').textContent = deck.isLocal ? 'Local audio · stays on this computer' : 'YouTube source';
  $('local-filename').textContent = deck.isLocal ? deck.name : '';
  $('groove-mode').textContent = deck.isLocal ? 'Grooves from your audio' : 'Groove texture';
  $('groove-help').textContent = deck.isLocal ? 'Quiet passages appear as darker bands' : 'Attach audio to reveal quiet passages';
  $('rate-label').textContent = deck.isLocal ? 'Pitch' : 'Speed';
  $('deck-pitch-label').textContent = deck.isLocal ? 'Pitch adj.' : 'Stream speed';
  $('deck-pitch').disabled = sourceLoading; $('pitch-reset').disabled = sourceLoading;
  $('speed-33').disabled = !deck.isLocal; $('speed-45').disabled = !deck.isLocal; $('record-rpm').disabled = !deck.isLocal; $('record-rpm').value = String(rpm);
  $('local-button').textContent = deck.isLocal ? 'Replace file' : 'Attach a file';
  $('stream-button').hidden = !deck.isLocal;
  $('vinyl-pitch').hidden = !deck.isLocal; $('stream-rate').hidden = deck.isLocal;
  $('rate-label').htmlFor = deck.isLocal ? 'vinyl-pitch' : 'stream-rate';
  $('motor-feel').disabled = !deck.isLocal;
  $('motor-feel').title = deck.isLocal ? 'How quickly the platter follows speed changes' : 'Attach local audio to use a smooth vinyl motor';
  $('speed-help').textContent = deck.isLocal ? 'Vinyl mode · pitch and tempo together' : 'YouTube · stepped speed, pitch handled by YouTube';
  renderRateOptions(); rateDisplay();
}
function playingIntent() { return sourceLoading || deck.buffering ? wantedPlaying : deck.playing && !deck.motorStopping; }
function motorSettings() { return {quick: {glide: .08, start: .16, stop: .22}, natural: {glide: .28, start: .38, stop: .65}, heavy: {glide: .65, start: .8, stop: 1.2}}[motorFeel]; }
function changeRate(rate) { return deck.setRate(rate, {glide: motorSettings().glide}); }
async function selectRecord(record, autoPlay = playingIntent(), startAt = null) {
  if(!record||excludedIds.has(record.youtubeId))return;
  padTransport.cancelHold();padRouter.clear();
  const token = ++loading; clearTimeout(seekTimer); pendingInitialSeek = null; deck.pause(); selected = record;
  updateSleeveDisplay(record);
  sourceLoading = true; selectionFailed=false; $('playback-recovery').hidden=true; wantedPlaying = autoPlay; lastRatesKey = ''; renderTransport();
  for(const id of ['deck-pitch','pitch-reset','speed-33','speed-45','record-rpm','motor-feel'])$(id).disabled=true;
  fineAnchor = record.sampleIn || 0; needleLifted = false; $('cue-button').setAttribute('aria-pressed', 'false'); $('deck').classList.remove('is-lifted');
  $('dock-title').textContent=displayTitle(record);
  $('record-artist').textContent = recordArtist(record); $('record-title').textContent = displayTitle(record); $('record-year').textContent = [record.year,record.genre].filter(Boolean).join(' · ');
  for(const id of ['record-title','record-artist','record-year'])$(id).title=$(id).textContent;
  for(const [label,source] of [['label-title','record-title'],['label-artist','record-artist'],['label-meta','record-year']]){
    $(label).textContent=$(source).textContent;
    $(label).title=$(source).textContent;
    $(label).classList.toggle('long-writing',$(source).textContent.length>40);
  }
  $('source-link').href = `https://www.youtube.com/watch?v=${record.youtubeId}`;
  grooveData = null; lastDuration = 0; rpm = 33; $('speed-33').classList.add('active'); $('speed-45').classList.remove('active');
  for (const speed of [33, 45]) $('speed-' + speed).setAttribute('aria-pressed', String(speed === 33));
  renderCrate(); renderMarks(); drawGrooves(); save(); status('Putting the record on…');
  let streamStarted=false;
  try {
    if (localFiles.has(record.id)) {
      const buffer = await deck.attachLocal(localFiles.get(record.id));
      if (token !== loading || !buffer) return;
      grooveData = analyseGrooves(buffer);
    } else if (!streamOnly.has(record.id) && downloadState.jobs.some(j=>j.id===record.youtubeId&&j.state==='ready')) {
      const response = await fetch(`/api/audio/${record.youtubeId}`);
      if (!response.ok) throw new Error('Downloaded audio could not be opened. Retry the download or use YouTube.');
      const blob = await response.blob(); if (token !== loading) return;
      const file = new File([blob], `${displayTitle(record)}.flac`, {type:'audio/flac'});
      const buffer = await deck.attachLocal(file); if(token!==loading||!buffer)return;
      grooveData = analyseGrooves(buffer);
    } else { streamStarted=wantedPlaying;await deck.useYouTube(record.youtubeId,{autoPlay:streamStarted,startAt:startAt??record.sampleIn}); if (token !== loading) return; }
    setSourceAppearance(); resetPickup(); drawGrooves();
    const initialTime = startAt ?? record.sampleIn;
    if (initialTime) { if (deck.duration) deck.seek(initialTime); else pendingInitialSeek = {id: record.id, time: initialTime}; }
    if (wantedPlaying&&!streamStarted) await deck.motorStart({duration: motorSettings().start});
    else if(!wantedPlaying&&streamStarted)deck.pause();
    if (token !== loading) return;
    if(!deck.lastError)status(deck.isLocal ? 'Vinyl mode. Pitch and tempo glide together.' : 'Drop the needle to explore. Download audio for vinyl pitch.');
  } catch (error) { if (token === loading) { selectionFailed=true; wantedPlaying=false; setSourceAppearance(); status(error.message, true); $('playback-recovery').hidden=false; $('recovery-youtube').href=$('source-link').href; } }
  finally { if (token === loading) { sourceLoading = false; renderRateOptions(); renderTransport(); } }
}
async function togglePlay() {
  padTransport.cancelHold(false);
  if (!selected) return;
  if (selectionFailed) { await selectRecord(selected,true); return; }
  if (sourceLoading) { wantedPlaying = !wantedPlaying; status(wantedPlaying ? 'The record will start when it is ready.' : 'The record will stay stopped when it is ready.'); return; }
  try {
    if (playingIntent()) { wantedPlaying = false; deck.motorStop({duration: motorSettings().stop}); }
    else { wantedPlaying = true; needleLifted = false; $('cue-button').setAttribute('aria-pressed', 'false'); $('deck').classList.remove('is-lifted'); await deck.motorStart({duration: motorSettings().start}); }
  } catch (error) { status(error.message, true); }
}
async function seekTo(seconds, play = false) {
  if (selectionFailed||!deck.duration) { status('The record is still loading. Try again when its length appears.'); return; }
  const target = clamp(seconds, 0, deck.duration);
  deck.seek(target); fineAnchor = target; resetPickup();
  if (play) try { await deck.play(); } catch (error) { status(error.message, true); }
}
function rateDisplay() {
  const pitch = (deck.rate / (rpm === 45 ? 45 / (100 / 3) : 1) - 1) * 100;
  $('pitch-readout').textContent = deck.isLocal ? `${pitch > .01 ? '+' : ''}${pitch.toFixed(1)}%` : `${deck.rate.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;
  if (deck.isLocal && !seeking) { $('deck-pitch').value = clamp(pitch, -8, 8); $('vinyl-pitch').value = clamp(pitch, -8, 8); }
  if (!deck.isLocal) $('stream-rate').value = String(deck.rate);
  const artworkPitch = deck.isLocal ? clamp(Number($('deck-pitch').value),-8,8) : rateToFader(deck.rate, deck.availableRates);
  if(!deck.isLocal)$('deck-pitch').value=artworkPitch;
  $('deck-pitch').setAttribute('aria-valuetext',deck.isLocal ? `${pitch.toFixed(1)} percent pitch` : `${deck.rate} times streaming speed`);
  $('pitch-thumb').setAttribute('transform',`translate(0.5 ${faderArtworkOffset(artworkPitch)})`);
}
function renderRateOptions() {
  const adjustable=!sourceLoading&&(deck.isLocal||deck.availableRates.length>1);
  $('deck-pitch').disabled=!adjustable;$('pitch-reset').disabled=!adjustable;
  if (deck.isLocal) return;
  const rates = deck.availableRates, key = rates.join(',');
  if (key === lastRatesKey) return;
  lastRatesKey = key;
  $('stream-rate').replaceChildren(...rates.map(rate => new Option(rate === 1 ? '1× normal' : `${rate}× speed`, String(rate))));
  $('stream-rate').value = String(deck.rate);
  $('stream-rate').disabled = rates.length < 2;
}
function renderTransport() {
  libraryUI.updatePlayback({id:selected?.id,playing:deck.playing,loading:sourceLoading,error:deck.lastError?.message||''});
  const running = playingIntent();
  if(deck.playing&&selected&&streamProblems[selected.id]){delete streamProblems[selected.id];$('playback-recovery').hidden=true;save();renderCrate();}
  $('deck').classList.toggle('is-playing', deck.playing);
  $('now-playing-state').textContent=sourceLoading?'Loading record':selectionFailed?'Could not load':!deck.isLocal&&deck.lastError?'Playback unavailable':deck.playing?'Now playing':'On the deck';
  $('now-playing').classList.toggle('is-playing',deck.playing);
  $('play-button').setAttribute('aria-label', running ? 'Stop record' : 'Start record');
  $('play-button').setAttribute('aria-busy', String(sourceLoading || deck.buffering));
  $('play-button').querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
  $('start-button').querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
  const actualRate = deck.currentRate ?? deck.rate;
  $('motor-state').textContent = selectionFailed ? 'Could not load' : sourceLoading ? 'Loading' : deck.buffering && wantedPlaying ? 'Buffering' : deck.motorStopping ? 'Slowing down' : deck.playing && deck.isLocal && Math.abs(actualRate - deck.rate) > .02 ? (actualRate < deck.rate ? 'Speeding up' : 'Slowing down') : deck.playing ? 'Playing' : 'Stopped';
  $('motor-state').classList.toggle('running', deck.playing);
  drawMatrix($('matrix'),{time:deck.currentTime,duration:deck.duration,rate:deck.isLocal?(deck.currentRate||deck.rate):deck.rate,local:deck.isLocal,grooves:grooveData,state:$('motor-state').textContent});
  $('display-play').querySelector('use').setAttribute('href',running?'#i-pause':'#i-play');
  $('dock-play').querySelector('use').setAttribute('href',running?'#i-pause':'#i-play');
  $('dock-play').setAttribute('aria-label',running?'Stop record':'Start record');$('dock-play-label').textContent=running?'Stop':'Play';
  $('dock-state').textContent=$('motor-state').textContent;$('dock-keep').disabled=!deck.duration||sourceLoading;
  if(narrowLayout.matches){const browsing=$('crate-surface').getBoundingClientRect().top<innerHeight*.5;for(const link of document.querySelectorAll('[data-surface]')){const current=link.dataset.surface===(browsing?'crate':'deck');link.classList.toggle('current',current);if(current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}}
  renderDownloadAction();
}
deck.addEventListener('change', () => {
  if (!sourceLoading && !deck.buffering) wantedPlaying = deck.playing && !deck.motorStopping;
  renderTransport();
  rateDisplay();
  if (selected && deck.playing && !heard.has(selected.id)) { heard.add(selected.id); save(); if (view === 'unheard') renderCrate(); }
});
deck.addEventListener('error', event => {
  const {message,code,videoId}=event.detail;
  if(videoId&&selected?.youtubeId!==videoId)return;
  if(!deck.isLocal&&selected&&Number(code)===100){const id=selected.youtubeId;void excludeUnavailable([id]);status('Unavailable upload removed from your lists.');return;}
  if(!deck.isLocal&&selected){streamProblems[selected.id]={code,message};save();renderCrate();}
  wantedPlaying=false;status(message,true);$('playback-recovery').hidden=false;
  $('recovery-youtube').href=$('source-link').href;
});
deck.addEventListener('ended',()=>{
  // A held audition, manual stop, or needle drag must never start another record.
  if(sourceLoading||selectionFailed||needleLifted||seeking||padTransport.gate!==null)return;
  adjacent(1,true);
});
$('retry-record').addEventListener('click',()=>{if(selected)selectRecord(selected,true);});

function pointerTime(event) {
  const box = $('record-surface').getBoundingClientRect(), x = event.clientX - box.left - box.width / 2, y = event.clientY - box.top - box.height / 2;
  const radius = Math.hypot(x, y) / (box.width / 2);
  return (1 - clamp((radius - GROOVES.inner*2) / ((GROOVES.outer-GROOVES.inner)*2), 0, 1)) * deck.duration;
}
function dragStart(event) {
  if (event.button !== 0 || !deck.duration) { if (!deck.duration) status('Wait for the record length before dropping the needle.'); return; }
  event.preventDefault(); activeDrag = event.currentTarget; activeDrag.setPointerCapture(event.pointerId);
  seeking = true; dragResume = deck.playing; deck.pause(); $('arm').classList.add('dragging');
  dragMove(event);
}
function dragMove(event) {
  if (!seeking || activeDrag !== event.currentTarget) return;
  dragTime = pointerTime(event); updateArm(dragTime / deck.duration);
  const box = $('record-surface').getBoundingClientRect(), tooltip = $('drop-position');
  tooltip.textContent = formatTime(dragTime); tooltip.hidden = false;
  tooltip.style.left = `${clamp(event.clientX - box.left + 15, 10, box.width - 60)}px`;
  tooltip.style.top = `${clamp(event.clientY - box.top - 33, 10, box.height - 35)}px`;
  $('elapsed').textContent = formatTime(dragTime); $('scan-readout').textContent = `Drop at ${formatTime(dragTime)}`;
}
async function dragEnd(event, cancel = false) {
  if (!seeking || activeDrag !== event.currentTarget) return;
  seeking = false; activeDrag = null; $('arm').classList.remove('dragging'); $('drop-position').hidden = true;
  if (!cancel) { needleLifted = false; $('cue-button').setAttribute('aria-pressed', 'false'); $('deck').classList.remove('is-lifted'); await seekTo(dragTime, true); }
  else if (dragResume) await deck.play().catch(error => status(error.message, true));
}
for (const element of [$('arm'), $('record-surface')]) {
  element.addEventListener('pointerdown', dragStart); element.addEventListener('pointermove', dragMove);
  element.addEventListener('pointerup', event => dragEnd(event)); element.addEventListener('pointercancel', event => dragEnd(event, true));
}
function updateArm(progress) {
  // Keep the mechanical pivot fixed and carry the headshell along its natural arc.
  const angle = needleAngle(progress) + (needleLifted ? -6 : 0);
  $('arm-moving').setAttribute('transform', `rotate(${angle} 1052 321)`);
  $('arm').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  $('arm').setAttribute('aria-valuetext', formatTime(deck.currentTime));
}
$('arm').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? deck.duration : deck.currentTime + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .25 : 5);
  seekTo(target);
});
$('cue-button').addEventListener('click', async () => {
  needleLifted = !needleLifted; $('cue-button').setAttribute('aria-pressed', String(needleLifted)); $('deck').classList.toggle('is-lifted', needleLifted);
  if (needleLifted) { resumeAfterCue = deck.playing; deck.pause(); status('Needle lifted. Move it to another part of the record.'); }
  else if (resumeAfterCue) await deck.play().catch(error => status(error.message, true));
});
$('position').addEventListener('input', event => { if (deck.duration) seekTo(Number(event.target.value) / 1000 * deck.duration); });
function manualPitch(event) { changeRate(deck.isLocal ? (1 + Number(event.target.value) / 100) * (rpm === 45 ? 45 / (100 / 3) : 1) : faderToRate(event.target.value,deck.availableRates)); resetPickup(); rateDisplay(); }
$('deck-pitch').addEventListener('keydown',event=>{
  if(deck.isLocal||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();
  changeRate(stepStreamRate(deck.rate,deck.availableRates,['ArrowUp','ArrowRight'].includes(event.key)?1:-1));
  resetPickup();rateDisplay();
});
$('deck-pitch').addEventListener('input', manualPitch); $('vinyl-pitch').addEventListener('input', manualPitch);
function resetSpeed() { changeRate(deck.isLocal && rpm === 45 ? 45 / (100 / 3) : 1); resetPickup(); rateDisplay(); }
$('pitch-reset').addEventListener('click', resetSpeed); $('speed-reset').addEventListener('click', resetSpeed);
$('stream-rate').addEventListener('change', event => { changeRate(Number(event.target.value)); resetPickup(); rateDisplay(); });
$('motor-feel').value = motorFeel;
$('motor-feel').addEventListener('change', event => { motorFeel = event.target.value; save(); status(`${event.target.selectedOptions[0].textContent} motor feel. Speed changes glide; Start / stop follows the platter.`); });
function selectRPM(speed) {
  if (!deck.isLocal || ![33,45].includes(speed)) return; rpm = speed; $('record-rpm').value = String(speed);
  for (const other of [33, 45]) { $('speed-' + other).classList.toggle('active', speed === other); $('speed-' + other).setAttribute('aria-pressed', String(speed === other)); }
  changeRate((1 + Number($('deck-pitch').value) / 100) * (rpm === 45 ? 45 / (100 / 3) : 1)); resetPickup(); rateDisplay();
}
for (const speed of [33,45]) $('speed-'+speed).addEventListener('click',()=>selectRPM(speed));
$('record-rpm').addEventListener('change',event=>selectRPM(Number(event.target.value)));
for (const id of ['play-button', 'start-button']) $(id).addEventListener('click', togglePlay);
function jumpRecord(digit) {
  if (!deck.duration || sourceLoading) return;
  // Seeking cancels a motor ramp; retain a pending stop rather than starting again.
  if (!playingIntent() && deck.motorStopping) deck.pause();
  seekTo(deck.duration * digit / 10);
}
for (const button of jumpButtons) button.addEventListener('click',()=>jumpRecord(Number(button.dataset.recordJump)));
function adjacent(direction, autoPlay=playingIntent()) { const list = visibleRecords(); if (!list.length) return; const index = list.findIndex(r => r.id === selected?.id); const next=index<0?(direction<0?list.length-1:0):(index+direction+list.length)%list.length; void selectRecord(list[next],autoPlay); }

function showDownloads(open=true) {
  if(open&&$('download-panel').hidden){downloadReturnScroll=window.scrollY;downloadFilter=downloadState.jobs.some(j=>j.state==='failed')?'attention':downloadState.active?'active':'all';downloadListKey='';renderDownloads();}
  $('crate-tools').open=false;
  $('download-panel').hidden=!open; $('downloads-button').setAttribute('aria-expanded',String(open));
  if(open){$('downloads-close').focus({preventScroll:true});$('download-panel').scrollIntoView({block:'start',behavior:'instant'});}
  else{$('downloads-button').focus({preventScroll:true});window.scrollTo({top:downloadReturnScroll,behavior:'instant'});}
}
function renderDownloadAction() {
  const job=downloadState.jobs.find(j=>j.id===selected?.youtubeId), active=job&&['queued','downloading','converting'].includes(job.state);
  $('download-record').disabled=!selected||!!active||!downloadAvailable;
  $('download-record').querySelector('span').textContent=active?(job.state==='queued'?'Queued':job.state==='converting'?'Converting…':`Downloading ${Math.round(job.progress)}%`):job?.state==='ready'?(deck.isLocal?'Downloaded':'Use downloaded audio'):'Download audio';
  if(job?.state==='ready'&&deck.isLocal)$('download-record').disabled=true;
  $('audio-availability').textContent=deck.isLocal?'Vinyl mode':active?'Preparing vinyl audio':job?.state==='failed'?'Download needs attention':'Streaming';
  $('audio-explanation').textContent=deck.isLocal?(job?.state==='ready'&&!localFiles.has(selected?.id)?'Downloaded audio · available after reopening':'Attached audio · available for this session'):job?.state==='failed'?explainDownloadError(job.error):active?'You can keep listening while the audio downloads.':'Download the audio for continuous vinyl pitch.';
}
function renderDownloads() {
  libraryUI.updateDownloads(downloadState);
  if(downloadState.audioDirectory)$('download-location').textContent=`Saved as FLAC in ${downloadState.audioDirectory}. Completed records load automatically.`;
  $('download-count').hidden=!downloadState.active; $('download-count').textContent=downloadState.active;
  const ready=downloadState.jobs.filter(j=>j.state==='ready').length,failed=downloadState.jobs.filter(j=>j.state==='failed').length;
  $('download-summary').textContent=!downloadAvailable?'Download service unavailable. Restart Record Room.':!downloadState.tools.ready?'Downloader unavailable. Reinstall Record Room or set up the source version.':`${ready} downloaded${downloadState.active?` · ${downloadState.active} pending`:''}${failed?` · ${failed} need attention`:''}`;
  if(downloadState.storageError)$('download-summary').textContent+=' · '+downloadState.storageError;
  $('download-cancel-all').disabled=!downloadState.active;
  $('download-crate').disabled=!downloadAvailable||!visibleRecords().length;
  const counts={attention:failed,active:downloadState.active,ready,all:downloadState.jobs.length};
  for(const button of downloadFilters){const filter=button.dataset.downloadFilter;button.setAttribute('aria-pressed',String(filter===downloadFilter));$(filter==='attention'?'attention-count':filter==='active'?'active-count':filter==='ready'?'ready-count':'all-count').textContent=counts[filter];}
  const jobs=orderedDownloads(downloadState.jobs,downloadFilter);
  const key=downloadFilter+'|'+jobs.map(j=>[j.id,j.state,j.error].join('|')).join('\n');
  if(key!==downloadListKey||!$('download-jobs').children.length){
    downloadListKey=key; const list=document.createDocumentFragment();
    if(!jobs.length)list.append(make('p','download-empty',downloadFilter==='attention'?'Nothing needs attention. Your downloads are up to date.':downloadFilter==='active'?'No downloads in progress. Completed audio is in Downloaded.':downloadFilter==='ready'?'No downloaded records yet. Choose a record and download its audio.':'Your download queue is empty. Download a record or the crate shown by your filters.'));
    for(const job of jobs){
      const row=make('div','download-job');row.dataset.id=job.id;
      const description=make('div','job-description');description.append(make('strong','',job.title));
      if(job.error){description.append(make('p','job-explanation',explainDownloadError(job.error)));const details=make('details','job-details');details.append(make('summary','','Technical details'),make('pre','',job.error));description.append(details);}
      const state=make('span','job-state');state.dataset.progress=job.id;
      const actions=make('div','job-actions');
      if(job.state!=='ready'){
        const button=make('button','',['queued','downloading','converting'].includes(job.state)?'Cancel':'Retry');button.setAttribute('aria-label',`${button.textContent} ${job.title}`);
        button.addEventListener('click',()=>{if(['queued','downloading','converting'].includes(job.state))cancelDownloads([job.id]);else queueDownloads([{youtubeId:job.id,title:job.title}]);});actions.append(button);
      }
      if(job.state==='failed'){const youtube=make('a','','Open YouTube');youtube.href=`https://www.youtube.com/watch?v=${job.id}`;youtube.target='_blank';youtube.rel='noopener noreferrer';actions.append(youtube);}
      row.append(description,state,actions);list.append(row);
    }
    $('download-jobs').replaceChildren(list);
  }
  for(const job of jobs){const node=$('download-jobs').querySelector(`[data-progress="${job.id}"]`);if(node)node.textContent=job.state==='downloading'?`${Math.round(job.progress)}%`:job.state==='ready'?'Downloaded':job.state==='converting'?'Converting':job.state==='queued'?'Queued':job.state==='cancelled'?'Cancelled':'Needs attention';}
  renderDownloadAction();
}
async function downloadRequest(path,body) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'The download request failed.');
  downloadState=result;renderDownloads();return result;
}
async function queueDownloads(list) {
  showDownloads();
  try{await downloadRequest('/api/downloads',{records:list.map(r=>({id:r.youtubeId,title:r.artist?`${r.artist} — ${displayTitle(r)}`:r.title}))});downloadFilter=downloadState.jobs.some(j=>['queued','downloading','converting'].includes(j.state))?'active':'all';downloadListKey='';renderDownloads();}
  catch(error){$('download-summary').textContent=error.message;status(error.message,true);}
}
async function cancelDownloads(ids){try{await downloadRequest('/api/downloads/cancel',{ids});}catch(error){$('download-summary').textContent=error.message;}}
async function refreshDownloads(autoLoad=true) {
  const previousReady=new Set(downloadState.jobs.filter(j=>j.state==='ready').map(j=>j.id));
  try{
    const response=await fetch('/api/downloads');if(!response.ok)throw new Error('Download service unavailable');
    downloadState=await response.json();receiveExclusions(downloadState.excludedIds);downloadAvailable=true;renderDownloads();
    const newReady=downloadState.jobs.some(j=>j.state==='ready'&&!previousReady.has(j.id));
    const failuresKey=downloadState.jobs.filter(j=>j.state==='failed').map(j=>j.id+j.error).join('|');
    if(failuresKey!==lastDownloadFailures){lastDownloadFailures=failuresKey;renderCrate();}
    if(newReady){renderCrate();if(autoLoad&&selected&&!deck.isLocal&&!streamOnly.has(selected.id)&&downloadState.jobs.some(j=>j.id===selected.youtubeId&&j.state==='ready'))selectRecord(selected,playingIntent(),deck.currentTime);}
  }catch{downloadAvailable=false;renderDownloads();}
}
$('downloads-button').addEventListener('click',()=>showDownloads($('download-panel').hidden));
$('downloads-close').addEventListener('click',()=>showDownloads(false));
$('download-crate').addEventListener('click',()=>queueDownloads(visibleRecords()));
$('download-cancel-all').addEventListener('click',()=>cancelDownloads(downloadState.jobs.filter(j=>['queued','downloading','converting'].includes(j.state)).map(j=>j.id)));
$('download-record').addEventListener('click',()=>{if(!selected)return;const job=downloadState.jobs.find(j=>j.id===selected.youtubeId);if(job?.state==='ready'){streamOnly.delete(selected.id);selectRecord(selected,playingIntent(),deck.currentTime);}else{streamOnly.delete(selected.id);queueDownloads([selected]);}});
$('display-play').addEventListener('click',togglePlay);
$('dock-play').addEventListener('click',togglePlay);$('dock-keep').addEventListener('click',()=>{keepMoment();drawGrooves();});
for(const button of downloadFilters)button.addEventListener('click',()=>{downloadFilter=button.dataset.downloadFilter;downloadListKey='';renderDownloads();});
for(const button of [$('import-button'),$('export-button')])button.addEventListener('click',()=>{$('crate-tools').open=false;});
document.addEventListener('pointerdown',event=>{if(!$('crate-tools').contains(event.target))$('crate-tools').open=false;});
$('crate-tools').addEventListener('keydown',event=>{if(event.key==='Escape'){$('crate-tools').open=false;$('crate-tools').querySelector('summary').focus();}});
for(const link of document.querySelectorAll('[data-surface]'))link.addEventListener('click',()=>{const target=link.dataset.surface==='crate'?$('crate-surface'):$('listening-surface');target.focus({preventScroll:true});});
setInterval(()=>refreshDownloads(),2000);
$('prev-button').addEventListener('click', () => adjacent(-1)); $('next-button').addEventListener('click', () => adjacent(1));
function randomRecord() {
  const next = randomCrate.next(visibleRecords(), selected?.id);
  if (next) selectRecord(next);
  else status('No other record matches these filters. Clear a filter to dig further.');
}
$('keep-button').addEventListener('click', () => { keepMoment(); drawGrooves(); });
$('scan-mode').value = scanMode;
$('scan-mode').addEventListener('change', event => { scanMode = event.target.value; fineAnchor = deck.currentTime; resetPickup(); save(); status(scanMode === 'fine' ? `Q-Link 1 now scans around ${formatTime(fineAnchor)}. Move the slider to pick up the needle position.` : 'Q-Link 1 now scans the whole record. Move the slider to pick up the needle position.'); });
for (const [id,key] of [['search','query'],['genre-filter','genre'],['year-filter','year']]) $(id).addEventListener(id==='search'?'input':'change',()=>{filters[libraryTab][key]=$(id).value;if(libraryTab==='dig')renewDig(false);else{renderCrate();save();}});
for(const tab of ['crate','dig'])$('tab-'+tab).addEventListener('click',()=>changeLibraryTab(tab));
document.querySelector('.library-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const tab=event.key==='Home'?'crate':event.key==='End'?'dig':libraryTab==='crate'?'dig':'crate';changeLibraryTab(tab);$('tab-'+tab).focus();});
$('keep-digging').addEventListener('click',()=>renewDig());
$('import-dig').addEventListener('click',()=>{importTarget='dig';$('json-file').click();});
$('import-channels').addEventListener('click',()=>{importTarget='channels';$('json-file').click();});
$('refresh-channels').addEventListener('click',()=>loadDiscovery(true,true,true));
$('deck').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
$('deck').addEventListener('drop', event => { event.preventDefault(); const record = [...records,...catalogue,...liveCatalogue].find(r => r.id === event.dataTransfer.getData('text/plain')); if (record) selectRecord(record); });

$('local-button').addEventListener('click', () => $('audio-file').click());
$('stream-button').addEventListener('click', () => { if (selected) { localFiles.delete(selected.id); streamOnly.add(selected.id); selectRecord(selected); } });
$('audio-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !selected) return;
  const recordId = selected.id, token = ++loading; clearTimeout(seekTimer); pendingInitialSeek = null; sourceLoading = true; wantedPlaying = false; renderTransport(); status(`Analysing ${file.name}…`);
  try {
    const buffer = await deck.attachLocal(file); if (token !== loading || selected.id !== recordId || !buffer) return;
    localFiles.set(recordId, file); grooveData = analyseGrooves(buffer); fineAnchor = 0; rpm = 33;
    $('speed-33').classList.add('active'); $('speed-45').classList.remove('active'); $('speed-33').setAttribute('aria-pressed', 'true'); $('speed-45').setAttribute('aria-pressed', 'false'); setSourceAppearance(); drawGrooves(); resetPickup();
    if (wantedPlaying) await deck.motorStart({duration: motorSettings().start});
    if (token !== loading || selected.id !== recordId) return;
    status('Audio attached. Groove bands now show this recording’s dynamics. Q-Link 2 changes speed and pitch continuously. Reattach the file after reopening.');
  } catch (error) { if (token === loading && selected.id === recordId) status(error.message, true); }
  finally { if (token === loading) { sourceLoading = false; renderRateOptions(); renderTransport(); } }
  event.target.value = '';
});
$('import-button').addEventListener('click', () => {importTarget='crate';$('json-file').click();});
$('json-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a crate JSON smaller than 8 MB.');
    const input = JSON.parse(await file.text());
    if(importTarget==='channels'||Array.isArray(input?.channels)){
      if(file.size>2000000)throw new Error('Choose a channel list smaller than 2 MB.');
      const response=await fetch('/api/discovery/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'Channel list could not be imported.');
      discoveryState.version=-1;discoveryStarted=true;await loadDiscovery(false);changeLibraryTab('dig',true);status(`Imported ${result.total} channel leads.${result.pending?` ${result.pending} need a confirmed address.`:''} ${result.running?'Checking the available addresses in the background.':'Cached sources are ready.'} My Crate is unchanged.`);return;
    }
    if(Array.isArray(input.recordRoom?.excludedIds))await excludeUnavailable(input.recordRoom.excludedIds.filter(id=>typeof id==='string'&&/^[\w-]{11}$/.test(id)));
    const imported = normalizeCrate(input), merged = new Map(records.map(r => [r.id, r]));
    const discoveries=Array.isArray(input.recordRoom?.catalogue)?normalizeCrate(input.recordRoom.catalogue):[];
    catalogue=[...new Map([...catalogue,...discoveries,...imported].map(record=>[record.id,record])).values()];
    if(importTarget==='dig'){changeLibraryTab('dig',true);status(`Imported ${imported.length} discovery records. Use the crate icons to save individual finds.`);return;}
    for (const record of imported) { merged.set(record.id, record); if (record.sampleOut > record.sampleIn && !marks[record.id]?.length) marks[record.id] = [{time: record.sampleIn, end: record.sampleOut, note: 'Imported selection'}]; }
    const extras = input.recordRoom;
    if (extras?.marks && typeof extras.marks === 'object') for (const r of imported) if (Array.isArray(extras.marks[r.id])) marks[r.id] = extras.marks[r.id].filter(m => m && Number.isFinite(m.time) && m.time >= 0).map(m => ({time: m.time, note: String(m.note || '')}));
    if(Array.isArray(extras?.heard))for(const id of extras.heard)if(typeof id==='string')heard.add(id);
    if(extras?.mappings&&typeof extras.mappings==='object')mappings=extras.mappings;
    if(extras?.padProfiles&&typeof extras.padProfiles==='object')for(const [name,profile] of Object.entries(extras.padProfiles))padProfiles[name]=cleanPadMappings(profile);
    records = [...merged.values()]; changeLibraryTab('crate'); renderMarks(); save(); status(`Imported ${imported.length} records. Your existing crate and moments are kept.`);
    if (!selected && records.length) selectRecord(records[0]);
  } catch (error) { status(`Could not import this crate. ${error.message}`, true); }
  finally {event.target.value = '';}
});
$('export-button').addEventListener('click', () => {
  save();const backup=JSON.parse(localStorage.getItem(STORAGE)||'{}');delete backup.records;
  const output = {favorites: records, recordRoom: {...backup,version:3,downloadDirectory:downloadState.audioDirectory,downloadJobs:downloadState.jobs}};
  const blob = new Blob([JSON.stringify(output, null, 2)], {type: 'application/json'}), url = URL.createObjectURL(blob), link = make('a');
  link.href = url; link.download = 'record-room-crate.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Exported the crate and your saved moments. Audio files are not included.');
});

async function discoverMidi() {
  try {
    const response = await fetch('/api/midi/ports'); if (!response.ok) throw new Error('Local MIDI bridge unavailable');
    const result = await response.json(); if (!result.available) throw new Error(result.error || 'Windows MIDI unavailable');
    $('midi-port').replaceChildren(new Option('Choose a MIDI input', ''));
    for (const port of result.ports) $('midi-port').add(new Option(port.name, `bridge:${port.id}`));
    const preferred = result.ports.find(p => /usb midi/i.test(p.name)); if (preferred) $('midi-port').value = `bridge:${preferred.id}`;
    $('midi-message').textContent = result.ports.length ? 'Choose the MPC adapter and connect. Nothing is sent to the MPC.' : 'No MIDI inputs found. Connect the MPC adapter, then reopen this panel.';
  } catch {
    $('midi-port').replaceChildren(new Option('Browser MIDI (permission required)', 'web'));
    $('midi-message').textContent = 'Connect to request MIDI input access in this browser.';
  }
}
function watchMidiEvents() {
  if (midiEvents) midiEvents.close();
  midiEvents = new EventSource('/api/midi/events');
  midiEvents.onopen=()=>{if(midiConnection==='bridge')$('midi-light').classList.add('connected');};
  midiEvents.onmessage = event => { try { onMidi(JSON.parse(event.data).data); } catch { /* Ignore malformed transport events. */ } };
  midiEvents.onerror = () => {resetPadInput(); $('midi-message').textContent = 'MIDI connection interrupted. Disconnect and reconnect this input.'; $('midi-light').classList.remove('connected'); };
}
async function restoreMidi() {
  try {
    const response = await fetch('/api/midi/status'); if (!response.ok) return;
    const state = await response.json(); if (!state.connected || !state.name) return;
    midiPort = {id: String(state.port), name: state.name}; midiConnection = 'bridge';
    $('midi-port').replaceChildren(new Option(state.name, `bridge:${state.port}`));
    watchMidiEvents(); setConnected(true, state.name);
  } catch { /* A static host can use the browser MIDI path instead. */ }
}
function setConnected(connected, name = '') {
  $('midi-light').classList.toggle('connected', connected); $('midi-summary').textContent = connected ? `${name || 'MIDI input'} connected` : 'Connect MPC';
  $('midi-connect').textContent = connected ? 'Disconnect input' : 'Connect input'; $('midi-port').disabled = connected;
  $('learn-scan').disabled = !connected; $('learn-pitch').disabled = !connected;$('midi-refresh').disabled=connected;$('learn-pads').disabled=!connected;
  $('midi-message').textContent = connected ? `${name}. Learn the pads below, or teach the Q-Link sliders here.` : 'Input disconnected. Your learned controls are saved.';
  renderLearning();renderPadMappings();
}
async function connectMidi() {
  try {
    if (midiConnection) {
      resetPadInput();
      if (midiEvents) { midiEvents.close(); midiEvents = null; }
      if (midiConnection === 'bridge') await fetch('/api/midi/connect', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: null})});
      if (midiConnection === 'web') { const input = webMidi?.inputs.get(midiPort?.id); if (input) { input.onmidimessage = null; await input.close(); } }
      midiConnection = null; midiPort = null; setConnected(false); return;
    }
    const selection = $('midi-port').value;
    if (!selection) { $('midi-message').textContent = 'Choose your MPC MIDI input first.'; return; }
    if (selection.startsWith('bridge:')) {
      const id = Number(selection.split(':')[1]), name = $('midi-port').selectedOptions[0].textContent;
      const response = await fetch('/api/midi/connect', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})});
      const result = await response.json(); if (!response.ok || result.error || !result.connected) throw new Error(result.error || 'Could not open this input. Close other apps using it, then retry.');
      midiPort = {id: String(id), name}; midiConnection = 'bridge'; watchMidiEvents();
      setConnected(true, name);
    } else {
      if (!navigator.requestMIDIAccess) throw new Error('This browser has no MIDI support. Start the supplied local server or open the app in Chrome or Edge.');
      webMidi = await navigator.requestMIDIAccess({sysex: false});
      const inputs = [...webMidi.inputs.values()];
      if (!inputs.length) throw new Error('No MIDI inputs found. Connect the MPC adapter and try again.');
      if (selection === 'web' && inputs.length > 1) {
        $('midi-port').replaceChildren(...inputs.map(p => new Option(p.name, `web:${p.id}`)));
        const preferred = inputs.find(p => /usb midi/i.test(p.name)); if (preferred) $('midi-port').value = `web:${preferred.id}`;
        $('midi-message').textContent = 'Choose the MPC adapter, then press Connect input.'; return;
      }
      const input = selection.startsWith('web:') ? webMidi.inputs.get(selection.slice(4)) : inputs[0];
      if (!input) throw new Error('This MIDI input is no longer connected. Reopen this panel.');
      await input.open(); midiPort = {id: input.id, name: input.name}; midiConnection = 'web'; input.onmidimessage = event => onMidi([...event.data]);
      webMidi.onstatechange = () => { if (input.state === 'disconnected') {resetPadInput(); midiConnection = null; setConnected(false); $('midi-message').textContent = 'MPC adapter disconnected. Reconnect it and reopen this panel.'; } };
      setConnected(true, input.name);
    }
    resetPickup();
  } catch (error) { $('midi-message').textContent = error.message; }
}
function renderLearning() {
  for (const kind of ['scan', 'pitch']) { const button = $('learn-' + kind); button.classList.toggle('learning', learning === kind);button.setAttribute('aria-pressed',String(learning===kind)); button.textContent = learning === kind ? 'Move the slider…' : `Learn ${kind === 'scan' ? 'Scan' : 'Pitch'}${mappings[kind] ? ` · CC ${mappings[kind].cc}` : ''}`; }
  for (const [kind, number] of [['scan', 1], ['pitch', 2]]) {
    const configured = midiConnection && mappings[kind]?.port === midiPort?.name;
    const indicator = $(kind + '-learn-status'); indicator.textContent = configured ? `Q${number} learned` : `Learn Q${number}`;
    indicator.classList.toggle('learned', !!configured);
    indicator.title = configured ? `Q-Link ${number}: channel ${mappings[kind].channel}, CC ${mappings[kind].cc}. Click to relearn.` : `Teach Q-Link ${number} to ${kind === 'scan' ? 'scan the record' : 'change speed'}`;
  }
}
function onMidiCC(data) {
  if (!Array.isArray(data) || data.length < 3 || (data[0] & 0xf0) !== 0xb0 || !midiPort) return;
  const channel = (data[0] & 0x0f) + 1, cc = data[1], value = data[2]; if (cc > 119 || value > 127) return;
  if (learning) {
    const other = mappings[learning === 'scan' ? 'pitch' : 'scan'];
    if (other && other.port === midiPort.name && other.channel === channel && other.cc === cc) { $('midi-message').textContent = 'That control is already assigned. Set a different CC for the second Q-Link.'; return; }
    if(Object.entries(currentPadMappings()).some(([,m])=>m.type==='cc'&&m.channel===channel&&m.number===cc)){$('midi-message').textContent='That CC is assigned to a pad. Use a different control for the Q-Link.';return;}
    const kind = learning; mappings[kind] = {port: midiPort.name, channel, cc}; learning = null; renderLearning(); resetPickup(); save();
      $('midi-message').textContent = `${kind === 'scan' ? 'Scan' : 'Pitch'} learned: channel ${channel}, CC ${cc}. Move through the current position to take control.`; return;
  }
  if (!Object.values(mappings).some(mapping => mapping.port === midiPort.name && mapping.channel === channel && mapping.cc === cc)) $('midi-message').textContent = `Receiving channel ${channel}, CC ${cc}, value ${value}. Press Learn Scan or Learn Pitch to assign this slider.`;
  for (const kind of ['scan', 'pitch']) {
    const mapping = mappings[kind]; if (!mapping || mapping.port !== midiPort.name || mapping.channel !== channel || mapping.cc !== cc) continue;
    const pickup = kind === 'scan' ? scanPickup : pitchPickup;
    if (!pickup.update(value)) { $('midi-message').textContent = `Move ${kind === 'scan' ? 'Scan' : 'Pitch'} through ${Math.round(pickup.target)} to pick up the current setting.`; continue; }
    if (kind === 'scan') {
      if (!deck.duration) { $('midi-message').textContent = 'Wait for the record length before scanning.'; continue; }
      const target = scanTarget(value, deck.duration, scanMode, fineAnchor); $('scan-readout').textContent = `Needle at ${formatTime(target)}`;
      clearTimeout(seekTimer); seekTimer = setTimeout(() => { deck.seek(target); }, deck.isLocal ? 35 : 180);
    } else {
      if (deck.isLocal) changeRate(pitchFromCC(value) * (rpm === 45 ? 45 / (100 / 3) : 1));
      else { const rates = deck.availableRates; if (rates.length > 1) changeRate(rates[Math.round(value / 127 * (rates.length - 1))]); else $('midi-message').textContent = 'This video offers only normal speed. Attach audio for continuous pitch control.'; }
      rateDisplay();
    }
  }
}

function currentPadMappings(){return padLearnAll&&padLearnDraft?padLearnDraft:midiPort?padProfiles[midiPort.name]||{}:{};}
function mappingLabel(mapping){return mapping?`Ch ${mapping.channel} · ${mapping.type==='note'?'Note':'CC'} ${mapping.number}`:'Not learned';}
function resetPadInput(){padTransport.cancelHold();padRouter.clear();padLearning=null;padLearnAll=false;padLearnPending=null;padLearnDraft=null;learning=null;document.querySelectorAll('.midi-pad').forEach(b=>b.classList.remove('is-pressed'));renderPadMappings();renderLearning();}
function renderPadMappings(){
  const profile=currentPadMappings(),count=Object.keys(profile).length;
  $('pad-profile-summary').textContent=midiPort?`${midiPort.name} · ${count} of 16 learned`:'Connect an input to learn its 16 pads.';
  $('learn-pads').disabled=!midiConnection;$('cancel-pad-learn').hidden=padLearning===null;
  for(const button of document.querySelectorAll('[data-midi-pad]')){
    const pad=Number(button.dataset.midiPad),mapping=profile[pad];button.disabled=!midiConnection;button.classList.toggle('learning',padLearning===pad);button.setAttribute('aria-pressed',String(padLearning===pad));
    button.querySelector('.pad-assignment').textContent=mappingLabel(mapping)+(mapping&&[13,14].includes(pad)&&!mapping.releaseVerified?' · relearn release':'');
    button.setAttribute('aria-label',`Learn pad ${pad}: ${padDescription(pad)}. ${mappingLabel(mapping)}`);
  }
}
function cancelPadLearning(){padLearning=null;padLearnAll=false;padLearnPending=null;padLearnDraft=null;renderPadMappings();$('pad-learn-message').textContent='Learning cancelled. Your previous mappings are kept. Select a pad to change it.';}
function beginPadLearning(pad,all=false){
  if(!midiConnection){$('pad-learn-message').textContent='Connect your MIDI input first.';return;}
  padTransport.cancelHold();padRouter.clear();resetPickup();learning=null;renderLearning();if(all){if(!padLearnAll||pad===1)padLearnDraft={};}else padLearnDraft=null;padLearning=pad;padLearnAll=all;padLearnPending=null;renderPadMappings();
  $('pad-learn-message').textContent=`${all?`Step ${pad} of 16. `:''}Press ${[13,14].includes(pad)?'and release ':''}pad ${pad} on your MPC. ${padDescription(pad)}. Learning does not play the record.`;
  void deck.preparePlayback().catch(()=>{$('midi-audio-help').textContent='Press Enable pad audio before playing from the hardware.';});
}
function learnPadSignal(signal){
  const reserved=Object.values(mappings).filter(m=>m.port===midiPort.name).map(m=>({type:'cc',channel:m.channel,number:m.cc}));
  const result=learnPadInput(signal,{pad:padLearning,profile:currentPadMappings(),reserved,pending:padLearnPending});
  if(result.status==='duplicate')$('pad-learn-message').textContent=`That control is already pad ${result.pad}. Press a different hardware pad for pad ${padLearning}.`;
  else if(result.status==='reserved')$('pad-learn-message').textContent='That CC belongs to a Q-Link. Tap a hardware pad instead.';
  else if(result.status==='release'){padLearnPending=result.signal;$('pad-learn-message').textContent=`Pad ${padLearning} pressed. Now release it so instant stopping can be verified. If no release arrives, check that the MPC sends Note Off, or use an on/off CC button.`;}
  else if(result.status==='learned')completePadLearning(result.signal,result.releaseVerified);
}

function completePadLearning(signal,releaseVerified){
  const pad=padLearning,profile=padLearnAll?padLearnDraft:(padProfiles[midiPort.name]||={});profile[pad]={type:signal.type,channel:signal.channel,number:signal.number,releaseVerified};
  if(padLearnAll&&pad<16){beginPadLearning(pad+1,true);return;}
  if(padLearnAll)padProfiles[midiPort.name]=padLearnDraft;padLearnDraft=null;save();
  padLearning=null;padLearnPending=null;padLearnAll=false;renderPadMappings();$('pad-learn-message').textContent=`Pad ${pad} learned. ${Object.keys(currentPadMappings()).length===16?'All 16 pads are ready.':'Choose another pad to learn.'} Mappings are saved for ${midiPort.name}.`;
}
for(const pad of MPC_PAD_ORDER){
  const button=make('button','midi-pad');button.type='button';button.dataset.midiPad=pad;button.append(make('strong','',String(pad)),make('span','pad-action',padDescription(pad)),make('span','pad-assignment','Not learned'));button.addEventListener('click',()=>beginPadLearning(pad));$('midi-pad-grid').append(button);
}
$('learn-pads').addEventListener('click',()=>beginPadLearning(1,true));$('cancel-pad-learn').addEventListener('click',cancelPadLearning);
$('midi-refresh').addEventListener('click',discoverMidi);
$('midi-enable-audio').addEventListener('click',async()=>{try{await deck.preparePlayback();$('midi-audio-help').textContent='Local pad audio enabled. Press and hold pads 13 or 14 to audition instantly.';}catch(error){$('midi-audio-help').textContent=error.message;}});
function onMidi(data){
  if(!midiPort||!Array.isArray(data)||data.length<3)return;
  // MIDI All Sound Off / All Notes Off must never leave a gate sounding.
  if((data[0]&240)===176&&[120,123].includes(data[1])){padTransport.stop();padRouter.clear();document.querySelectorAll('.midi-pad').forEach(b=>b.classList.remove('is-pressed'));return;}
  const signal=padMidiSignal(data);
  if(padLearning!==null){learnPadSignal(signal);return;}
  if(learning){onMidiCC(data);return;}
  const event=padRouter.process(data,currentPadMappings());
  if(event){
    const button=document.querySelector(`[data-midi-pad="${event.pad}"]`);button?.classList.toggle('is-pressed',event.down);
    if(event.down){if([13,14].includes(event.pad)&&!event.releaseVerified){$('pad-learn-message').textContent=`Relearn pad ${event.pad}, including release, before using its momentary action.`;return;}padTransport.press(event.pad);}
    else padTransport.release(event.pad);
    return;
  }
  if(signal&&Object.values(currentPadMappings()).some(mapping=>samePadSignal(signal,mapping)))return;
  if(signal?.type==='note'&&signal.down)$('midi-message').textContent=`Receiving channel ${signal.channel}, note ${signal.number}. Choose Learn all 16 or select a pad to assign it.`;
  onMidiCC(data);
}

$('midi-button').addEventListener('click', () => { $('crate-tools').open=false; const open = $('midi-panel').hidden; $('midi-panel').hidden = !open; $('midi-button').setAttribute('aria-expanded', String(open)); if(open){void deck.preparePlayback().catch(()=>{});$('midi-panel').scrollIntoView({block:'start',behavior:'instant'});$('midi-close').focus({preventScroll:true});if(!midiConnection)discoverMidi();}else{if(padLearning!==null)cancelPadLearning();learning=null;renderLearning();} });
$('midi-close').addEventListener('click', () => { if(padLearning!==null)cancelPadLearning();learning=null;renderLearning();$('midi-panel').hidden = true; $('midi-button').setAttribute('aria-expanded', 'false'); $('midi-button').focus({preventScroll:true}); });
$('midi-connect').addEventListener('click', connectMidi);
for (const kind of ['scan', 'pitch']) $('learn-' + kind).addEventListener('click', () => { if (!midiConnection) { $('midi-message').textContent = 'Connect a MIDI input before learning a slider.'; return; } padTransport.cancelHold();padLearning=null;padLearnPending=null;padLearnAll=false;padLearnDraft=null;renderPadMappings();learning = learning === kind ? null : kind; renderLearning(); });
for (const kind of ['scan', 'pitch']) $(kind + '-learn-status').addEventListener('click', () => {
  $('midi-panel').hidden = false; $('midi-button').setAttribute('aria-expanded', 'true');
  if (!midiConnection) { discoverMidi(); return; }
  $('qlink-setup').scrollIntoView({block:'center',behavior:'instant'});padLearning=null;padLearnPending=null;padLearnAll=false;padLearnDraft=null;renderPadMappings();learning = kind; renderLearning(); $('midi-message').textContent = `Move Q-Link ${kind === 'scan' ? '1' : '2'} to teach it ${kind === 'scan' ? 'Scan' : 'Pitch'}.`;
});
setConnected(false); renderLearning();

document.addEventListener('keydown', event => {
  if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))document.documentElement.classList.remove('shortcut-active');
  if(event.target.closest?.('[role=menu],#crate-tools[open]'))return;
  if (spaceHandled && event.repeat && event.code === 'Space') { event.preventDefault(); return; }
  const action = shortcutAction(event); if (!action) return;
  event.preventDefault(); event.stopPropagation();
  document.documentElement.classList.add('shortcut-active');
  if (action === 'toggle') { spaceHandled = true; togglePlay(); }
  else if (action === 'random') randomRecord();
  else if (action === 'dig') {if(libraryTab!=='dig')changeLibraryTab('dig',true);else renewDig();}
  else if (action === 'back' || action === 'forward') seekTo(deck.currentTime + (action === 'forward' ? 1 : -1) * (event.shiftKey ? .25 : 5));
  else if (action === 'mark') { keepMoment(); drawGrooves(); }
  else if (action.startsWith('jump:')) jumpRecord(Number(action.slice(5)));
}, true);
document.addEventListener('keyup', event => { if (spaceHandled && (event.code === 'Space' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); spaceHandled = false; } }, true);
window.addEventListener('blur', () => { spaceHandled = false; });
document.addEventListener('pointerdown',()=>document.documentElement.classList.remove('shortcut-active'),true);
function frame(now) {
  const elapsed = Math.min((now - previousFrame) / 1000, .2); previousFrame = now;
  if (deck.playing && !reducedMotion.matches) animationAngle = advancePlatter(animationAngle,elapsed,deck.currentRate ?? deck.rate);
  $('record-label').style.transform = `rotate(${animationAngle}deg)`; $('platter-rim').style.transform = `rotate(${animationAngle}deg)`;
  if (now - lastInterfaceTick > 90) {
    lastInterfaceTick = now; const d = deck.duration, time = deck.currentTime;
    renderTransport(); renderRateOptions(); rateDisplay();
    if (!seeking) { updateArm(d ? time / d : 0); $('elapsed').textContent = formatTime(time); $('position').value = d ? time / d * 1000 : 0; $('scan-readout').textContent = `Needle at ${formatTime(time)}`; }
    $('duration').textContent = d ? formatTime(d) : '—:—';
    $('position').disabled = !d; $('keep-button').disabled = !d;
    for (const button of jumpButtons) button.disabled = !d || sourceLoading || selectionFailed;
    if (d && d !== lastDuration) {
      lastDuration = d;
      if (pendingInitialSeek?.id === selected?.id) { deck.seek(pendingInitialSeek.time); fineAnchor = pendingInitialSeek.time; pendingInitialSeek = null; }
      resetPickup(); drawGrooves();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

async function init() {
  try {
    try{const response=await fetch('/api/collection/exclusions');if(response.ok)receiveExclusions((await response.json()).excludedIds);}catch{/* Saved exclusions remain effective offline. */}
    const knownUnavailable=Object.entries(streamProblems).filter(([,problem])=>Number(problem?.code)===100).map(([id])=>id).filter(id=>/^[\w-]{11}$/.test(id));
    if(excludedIds.size||knownUnavailable.length)await excludeUnavailable([...new Set([...excludedIds,...knownUnavailable])]);
    await refreshDownloads(false);
    if (stored.records) records = normalizeCrate(stored.records);
    else { const response = await fetch('data/crate.json'); if (!response.ok&&response.status!==404) throw new Error('Your starter crate could not load. Use Import crate to choose the JSON file.'); records = response.ok?normalizeCrate(await response.json()):[]; }
    catalogue=Array.isArray(stored.catalogue)?normalizeCrate(stored.catalogue):[...records];
    await loadDiscovery(false,false);
    const restoredTray=Array.isArray(stored.digRecords)?normalizeCrate(stored.digRecords):[];
    const restoredIds=[...new Set(Array.isArray(stored.digIds)?stored.digIds:[])],byId=new Map([...catalogue,...restoredTray,...liveCatalogue].map(record=>[record.id,record]));
    digBatch=filterRecords(restoredIds.map(id=>byId.get(id)).filter(Boolean),filters.dig).slice(0,10);digTray.current=digBatch.map(record=>record.id);
    if(liveCatalogue.length&&digBatch.some(record=>record.source!=='youtube-channel-feed'))digBatch=[];
    const restore=records.find(r=>r.id===stored.selected)||digPool().find(r=>r.id===stored.selected)||(stored.selectedRecord?normalizeCrate([stored.selectedRecord])[0]:null)||records[0];
    changeLibraryTab(libraryTab);
    if (restore) await selectRecord(restore);
    else status('Add a channel in Dig, or import a crate to start listening.');
  } catch (error) { status(error.message, true); renderCrate(); }
}
init();
restoreMidi();
