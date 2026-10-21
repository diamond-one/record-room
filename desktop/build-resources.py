"""Build a native Python service and stage only shipping web assets for Electron."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
stage=root/'.build'/'resources'
stage.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','record-room-service',
                '--distpath',str(root/'.build'/'service'),'--workpath',str(root/'.build'/'pyinstaller'),
                '--specpath',str(root/'.build'),'--collect-all','yt_dlp','--collect-all','yt_dlp_ejs','--collect-all','certifi',str(root/'server.py')],check=True,cwd=root)
shutil.copytree(root/'.build'/'service'/'record-room-service',stage/'backend',dirs_exist_ok=True)
web=stage/'web';web.mkdir(exist_ok=True)
for name in ['index.html','app.js','engine.js','interactions.js','mechanics.js','matrix.js','presentation.js','varispeed.js','library.js','style.css','listening.css','minimal.css','supplied.css','library.css']:
    shutil.copy2(root/name,web/name)
shutil.copytree(root/'assets',web/'assets',dirs_exist_ok=True)
(web/'data').mkdir(exist_ok=True)
# Collection data never ships in public installers. Existing app profiles are untouched.
(web/'data'/'channels.json').write_text('{"channels":[]}',encoding='utf-8')
(web/'data'/'discovery.json').write_text('{"version":0,"states":{},"records":[]}',encoding='utf-8')
(web/'data'/'crate.json').write_text('[]',encoding='utf-8')
binary=stage/'bin';binary.mkdir(exist_ok=True)
ffmpeg=subprocess.check_output(['node','-e','process.stdout.write(require("ffmpeg-static"))'],cwd=root,text=True).strip()
for source,name in [(ffmpeg,'ffmpeg'),(shutil.which('node'),'node')]:
    if not source:raise RuntimeError('A build runtime was not found: '+name)
    target=binary/(name+('.exe' if os.name=='nt' else ''));shutil.copy2(source,target);target.chmod(0o755)
notices=stage/'licenses';notices.mkdir(exist_ok=True)
python_license=Path(sys.base_prefix)/'LICENSE.txt'
if python_license.is_file():shutil.copy2(python_license,notices/'Python-LICENSE.txt')
for source in [root/'node_modules'/'ffmpeg-static'/'LICENSE',Path(ffmpeg+'.LICENSE'),Path(ffmpeg+'.README'),Path(shutil.which('node')).parent/'LICENSE']:
    if source.is_file():shutil.copy2(source,notices/(('node-' if source.parent==Path(shutil.which('node')).parent else 'ffmpeg-')+source.name))
(notices/'README.txt').write_text('Record Room bundles Electron, Node.js, Python, yt-dlp, yt-dlp-ejs and FFmpeg.\nElectron and Node.js: MIT; Python: PSF license; yt-dlp: Unlicense; yt-dlp-ejs: Unlicense.\nFFmpeg build license and source/build information are included alongside this notice.\nFont licenses are in web/assets.\nSee desktop/requirements-build.txt and package-lock.json for pinned versions.\n',encoding='utf-8')
subprocess.run(['node',str(root/'desktop'/'icon.cjs')],check=True,cwd=root)
print('Desktop resources ready:',stage)
