const {app,BrowserWindow,dialog,ipcMain,Menu,shell,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {trustedFrame,externalURL,libraryState}=require('./policy.cjs');
app.setName('Record Room');
app.commandLine.appendSwitch('force-renderer-accessibility');
let window=null,backend=null,origin='',quitting=false,dataPath,logPath;
const project=path.resolve(__dirname,'..');
const lock=app.requestSingleInstanceLock();
if(!lock){app.quit();}else{
  app.on('second-instance',(_event,args)=>{if(args.includes('--quit')){app.quit();return;}if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('Record Room could not start',`${error.message}\n\nDetails: ${logPath||'No log was created.'}`);backend?.kill();app.quit();});
}
function log(text){if(logPath)fs.appendFileSync(logPath,new Date().toISOString()+' '+text+'\n');}
function assertCaller(event){if(!trustedFrame(event.senderFrame,origin)||event.sender!==window?.webContents)throw new Error('Open this action from Record Room.');}
function saveFile(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',text);fs.renameSync(file+'.tmp',file);}
async function start(){
  dataPath=path.join(app.getPath('userData'),'library');fs.mkdirSync(dataPath,{recursive:true});logPath=path.join(app.getPath('userData'),'desktop.log');
  const resources=app.isPackaged?process.resourcesPath:path.join(project,'.build','resources');
  const web=path.join(resources,'web');
  for(const file of ['channels.json','discovery.json']){const seed=path.join(web,'data',file),target=path.join(dataPath,file);if(!fs.existsSync(target)&&fs.existsSync(seed))fs.copyFileSync(seed,target);}
  const stateFile=path.join(dataPath,'library.json');
  // Optional first-launch migration is local and never bundled into distributable installers.
  const migration=process.argv.find(arg=>arg.startsWith('--import-backup='));
  if(migration&&!fs.existsSync(stateFile)){
    const backup=JSON.parse(fs.readFileSync(migration.slice('--import-backup='.length),'utf8'));
    saveFile(stateFile,libraryState(JSON.stringify({...backup.recordRoom,records:backup.favorites})));
    const history=backup.recordRoom?.downloadJobs,oldFolder=backup.recordRoom?.downloadDirectory;
    if(Array.isArray(history)&&typeof oldFolder==='string'&&path.isAbsolute(oldFolder)){
      const jobs={};for(const job of history){if(!/^[a-zA-Z0-9_-]{11}$/.test(job.id))continue;const file=job.path||path.join(oldFolder,job.id+'.flac');jobs[job.id]={...job,path:file};}
      if(!fs.existsSync(path.join(dataPath,'downloads.json')))saveFile(path.join(dataPath,'downloads.json'),JSON.stringify(jobs));
    }
  }
  if(!fs.existsSync(path.join(dataPath,'settings.json'))){const folder=path.join(app.getPath('music'),'Record Room');fs.mkdirSync(folder,{recursive:true});saveFile(path.join(dataPath,'settings.json'),JSON.stringify({audioDirectory:folder}));}
  origin=await startBackend(resources,web);
  ipcMain.on('record-room:library-read',(event)=>{try{assertCaller(event);event.returnValue=fs.existsSync(stateFile)?libraryState(fs.readFileSync(stateFile,'utf8')):'';}catch{event.returnValue='';}});
  ipcMain.handle('record-room:library-save',(event,state)=>{assertCaller(event);saveFile(stateFile,libraryState(state));});
  ipcMain.handle('record-room:choose-directory',async event=>{
    assertCaller(event);const state=await (await fetch(origin+'/api/downloads')).json();
    const result=await dialog.showOpenDialog(window,{title:'Choose your record collection folder',defaultPath:state.audioDirectory,properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];
  });
  ipcMain.handle('record-room:open-directory',async event=>{assertCaller(event);const state=await (await fetch(origin+'/api/downloads')).json();fs.mkdirSync(state.audioDirectory,{recursive:true});const error=await shell.openPath(state.audioDirectory);if(error)throw new Error(error);});
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>{callback(contents===window?.webContents&&permission==='midi'&&details.requestingUrl?.startsWith(origin+'/'));});
  session.defaultSession.setPermissionCheckHandler((contents,permission,requestingOrigin)=>contents===window?.webContents&&permission==='midi'&&requestingOrigin===origin);
  session.defaultSession.webRequest.onHeadersReceived({urls:[origin+'/*']},(details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'"]}}));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{label:'File',submenu:[{label:'Close window',role:'close'},...(process.platform!=='darwin'?[{role:'quit'}]:[])]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
  ]));
  createWindow(resources);
  app.on('activate',()=>{if(!window)createWindow(resources);});
}
function startBackend(resources,web){
  return new Promise((resolve,reject)=>{
    const executable=path.join(resources,'backend','record-room-service'+(process.platform==='win32'?'.exe':''));
    const bin=path.join(resources,'bin'),environment={...process.env,PATH:bin+path.delimiter+process.env.PATH,PYTHONIOENCODING:'utf-8'};
    delete environment.ELECTRON_RUN_AS_NODE;
    backend=spawn(executable,['--port','18771','--root',web,'--data-directory',dataPath,'--desktop'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:environment});
    let buffer='',ready=false;const timer=setTimeout(()=>reject(new Error('The local audio service did not start.')),30000);
    backend.stdout.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);log(line);if(line.startsWith('RECORD_ROOM_READY=')){try{const {port}=JSON.parse(line.slice(18));if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid service port.');ready=true;clearTimeout(timer);resolve(`http://127.0.0.1:${port}`);}catch(error){reject(error);}}}});
    backend.stderr.on('data',chunk=>log(chunk.toString()));
    backend.on('error',error=>{clearTimeout(timer);reject(error);});
    backend.on('exit',code=>{clearTimeout(timer);backend=null;if(!ready)reject(new Error('The local audio service could not start. Another program may be using port 18771.'));else if(!quitting){dialog.showErrorBox('Audio service stopped','Close and reopen Record Room. Your collection is saved.');app.quit();}log('Service exited: '+code);});
  });
}
function createWindow(resources){
  window=new BrowserWindow({width:1440,height:1040,minWidth:390,minHeight:640,title:'Record Room',backgroundColor:'#f8f8f8',show:false,autoHideMenuBar:true,icon:path.join(resources,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{const allowed=externalURL(url);if(allowed)void shell.openExternal(allowed);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();const allowed=externalURL(url);if(allowed)void shell.openExternal(allowed);}});
  window.webContents.on('render-process-gone',(_,details)=>log('Renderer stopped: '+details.reason));
  window.webContents.on('did-fail-load',(_event,code,description)=>log(`Window load failed: ${code} ${description}`));
  window.webContents.on('console-message',(_,details)=>{if(details.level==='error')log('Renderer: '+details.message);});
  window.once('ready-to-show',()=>{window.show();log('Desktop window ready.');});window.on('closed',()=>{window=null;});
  void window.loadURL(origin+'/');
}
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',event=>{if(backend&&!quitting){event.preventDefault();quitting=true;backend.stdin.end();const timer=setTimeout(()=>{backend?.kill();app.exit();},5000);backend.once('exit',()=>{clearTimeout(timer);app.exit();});}});
