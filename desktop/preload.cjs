const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('recordRoom',{
  initialLibrary:ipcRenderer.sendSync('record-room:library-read'),
  saveLibrary:state=>ipcRenderer.invoke('record-room:library-save',state),
  chooseDownloadDirectory:()=>ipcRenderer.invoke('record-room:choose-directory'),
  openDownloadDirectory:()=>ipcRenderer.invoke('record-room:open-directory')
});
