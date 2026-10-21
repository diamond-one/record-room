/** Source management and the record collection folder; no hardware or transport state here. */
export function initLibraryControls({onDiscovery,onPlay,onToggle,closeTools}){
  const $=id=>document.getElementById(id);
  let discovery={channels:[]},downloads={},limit=60,previewKey=null,previewToken=0,editing=null,lastKey='',playback={},playbackKey='';
  const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const menuButton=make('button','','Channel sources');menuButton.id='manage-sources-menu';menuButton.type='button';$('import-button').after(menuButton);
  const manageButton=make('button','','Manage channels');manageButton.id='manage-sources';manageButton.type='button';$('refresh-channels').before(manageButton);
  const previewStatus=make('p');previewStatus.id='source-preview-playback';previewStatus.setAttribute('role','status');$('source-preview-records').before(previewStatus);
  const message=(text,error=false)=>{$('sources-message').textContent=text;$('sources-message').classList.toggle('error',error);};
  async function request(path,body){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Please try again.');return result;
  }
  function receive(result){discovery=result;onDiscovery(result);renderSources();}
  function showSources(){closeTools();$('sources-panel').hidden=false;$('sources-panel').scrollIntoView({block:'start',behavior:'instant'});$('sources-close').focus({preventScroll:true});renderSources();}
  $('manage-sources').addEventListener('click',showSources);$('manage-sources-menu').addEventListener('click',showSources);
  $('sources-close').addEventListener('click',()=>{$('sources-panel').hidden=true;($('manage-sources').getClientRects().length?$('manage-sources'):$('crate-tools').querySelector('summary')).focus({preventScroll:true});});
  for(const id of ['sources-search','sources-filter'])$(id).addEventListener(id==='sources-search'?'input':'change',()=>{limit=60;renderSources();});
  $('sources-more').addEventListener('click',()=>{limit+=60;renderSources();});
  $('source-cancel-edit').addEventListener('click',resetForm);
  function resetForm(){editing=null;$('source-form').reset();$('source-submit').textContent='Add channel';$('source-cancel-edit').hidden=true;}
  $('source-form').addEventListener('submit',async event=>{
    event.preventDefault();$('source-submit').disabled=true;message(editing?'Updating channel…':'Adding channel…');
    try{
      const payload={url:$('source-url').value.trim(),name:$('source-name').value.trim(),genres:$('source-genres').value.split(',').map(s=>s.trim()).filter(Boolean)};
      if(editing)payload.replaceKey=editing;
      receive(await request('/api/discovery/add',payload));resetForm();message('Channel saved. Recent records appear once its feed is checked.');
    }catch(error){message(error.message,true);}finally{$('source-submit').disabled=false;}
  });
  $('source-undo').addEventListener('click',async()=>{try{receive(await request('/api/discovery/undo',{}));message('Channel restored.');}catch(error){message(error.message,true);}});
  function renderSources(){
    const all=discovery.channels||[],query=$('sources-search').value.trim().toLocaleLowerCase(),filter=$('sources-filter').value;
    const filtered=all.filter(c=>(!query||[c.name,c.seedName,c.url,...(c.genres||[])].join(' ').toLocaleLowerCase().includes(query))&&(filter==='all'||(filter==='ready'?c.status==='ready':filter==='pending'?!c.url:c.status==='failed')));
    $('sources-count').textContent=`${filtered.length} ${filtered.length===1?'source':'sources'}${query||filter!=='all'?` of ${all.length}`:''}`;
    $('source-undo').hidden=!discovery.canUndo;
    $('sources-more').hidden=filtered.length<=limit;$('sources-more').textContent=`Show more (${Math.max(0,filtered.length-limit)} remaining)`;
    const fragment=document.createDocumentFragment();
    for(const c of filtered.slice(0,limit)){
      const row=make('div','source-row'),info=make('div','source-info');
      info.append(make('strong','',c.name||c.seedName),make('span','source-address',c.url||'No channel address yet'));
      const state=make('span','source-state',c.status==='ready'?`${c.count||0} recent records`:!c.url?'Needs an address':c.status==='failed'?'Check address':discovery.running?'Checking…':'Not checked');
      const actions=make('div','source-actions'),preview=make('button','', 'Preview');preview.type='button';preview.setAttribute('aria-label',`Preview ${c.name||c.seedName}`);preview.setAttribute('aria-pressed',String(previewKey===c.key));
      preview.addEventListener('click',()=>previewSource(c));
      const edit=make('button','text-action','Edit');edit.type='button';edit.setAttribute('aria-label',`Edit ${c.name||c.seedName}`);edit.addEventListener('click',()=>{editing=c.key;$('source-url').value=c.url||'';$('source-name').value=c.seedName||c.name||'';$('source-genres').value=(c.genres||[]).join(', ');$('source-submit').textContent='Save channel';$('source-cancel-edit').hidden=false;$('source-url').focus();});
      const remove=make('button','text-action','Remove');remove.type='button';remove.setAttribute('aria-label',`Remove source ${c.name||c.seedName}`);
      remove.addEventListener('click',async()=>{remove.disabled=true;try{receive(await request('/api/discovery/remove',{key:c.key}));if(previewKey===c.key){previewToken++;previewKey=null;$('source-preview').hidden=true;}message(`Removed ${c.name||c.seedName}. Saved records and audio stay in My Crate.`);$('source-undo').focus({preventScroll:true});}catch(error){message(error.message,true);remove.disabled=false;}});
      actions.append(preview,edit,remove);row.append(info,state,actions);fragment.append(row);
    }
    if(!filtered.length)fragment.append(make('p','sources-empty',all.length?'No sources match. Clear the search or change the filter.':'Add your first YouTube channel above.'));
    $('sources-list').replaceChildren(fragment);
  }
  async function previewSource(channel){
    previewKey=channel.key;const token=++previewToken;renderSources();$('source-preview').hidden=false;$('source-preview-title').textContent=channel.name||channel.seedName;$('source-preview-records').replaceChildren(make('p','','Loading recent records…'));
    const link=$('source-preview-link');link.hidden=!channel.url;link.href=channel.url||'#';
    try{
      const response=await fetch('/api/discovery/preview?key='+encodeURIComponent(channel.key));const result=await response.json();if(token!==previewToken)return;if(!response.ok)throw new Error(result.error);
      const fragment=document.createDocumentFragment();
      for(const record of result.records){
        const button=make('button','source-preview-track');button.type='button';button.dataset.recordId=record.id;button.dataset.recordTitle=record.title;button.setAttribute('aria-label',`Play ${record.title}`);const img=make('img');img.src=`https://i.ytimg.com/vi/${record.youtubeId}/hqdefault.jpg`;img.alt='';img.loading='lazy';
        button.append(img,make('span','',record.title));button.addEventListener('click',()=>{if(playback.id===record.id&&!playback.error)onToggle();else onPlay(record);});fragment.append(button);
      }
      if(!result.records.length)fragment.append(make('p','',channel.url?'No cached records yet. Check channels, or edit this source’s address.':'Add a channel address with Edit to preview its records.'));
      $('source-preview-records').replaceChildren(fragment);
    }catch(error){if(token===previewToken)$('source-preview-records').replaceChildren(make('p','',error.message||'Could not open this source.'));}
    $('source-preview').scrollIntoView({block:'nearest',behavior:'instant'});
  }
  $('source-preview-close').addEventListener('click',()=>{previewToken++;previewKey=null;$('source-preview').hidden=true;renderSources();});
  $('collection-form').addEventListener('submit',async event=>{event.preventDefault();await saveDirectory($('collection-directory').value);});
  async function saveDirectory(directory){
    $('collection-save').disabled=true;$('collection-message').textContent='Saving folder…';
    try{const result=await request('/api/downloads/directory',{directory});downloads=result;updateDownloads(result);$('collection-message').textContent='Future downloads will go here. Existing audio stays available.';}
    catch(error){$('collection-message').textContent=error.message;}finally{$('collection-save').disabled=!!downloads.active;}
  }
  $('collection-choose').hidden=!window.recordRoom;
  $('collection-open').hidden=!window.recordRoom;
  $('collection-choose').addEventListener('click',async()=>{try{const path=await window.recordRoom.chooseDownloadDirectory();if(path){$('collection-directory').value=path;await saveDirectory(path);}}catch(error){$('collection-message').textContent=error.message;}});
  $('collection-open').addEventListener('click',async()=>{try{await window.recordRoom.openDownloadDirectory();}catch(error){$('collection-message').textContent=error.message;}});
  function updateDownloads(state){downloads=state;const input=$('collection-directory');if(document.activeElement!==input)input.value=state.audioDirectory||'';for(const id of ['collection-save','collection-choose'])$(id).disabled=!!state.active;}
  return {updateDownloads,updatePlayback(state){playback=state;const key=JSON.stringify(state);if(key===playbackKey)return;playbackKey=key;for(const button of $('source-preview-records').querySelectorAll('[data-record-id]')){const active=state.id===button.dataset.recordId;button.setAttribute('aria-pressed',String(active&&state.playing));button.setAttribute('aria-label',`${active&&state.playing?'Pause':'Play'} ${button.dataset.recordTitle}`);if(active)$('source-preview-playback').textContent=state.error?state.error:state.loading?'Loading record…':state.playing?'Playing — select this record again to pause.':'Paused — select this record again to play.';}},updateDiscovery(state){discovery=state;const key=JSON.stringify([state.channels,state.running,state.canUndo]);if(key!==lastKey){lastKey=key;if(!$('sources-panel').hidden)renderSources();}}};
}
