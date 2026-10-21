const fs=require('node:fs'),path=require('node:path');
const {Resvg}=require('@resvg/resvg-js');
const root=path.resolve(__dirname,'..'),png=new Resvg(fs.readFileSync(path.join(root,'assets/icon.svg')),{fitTo:{mode:'width',value:512}}).render().asPng();
fs.writeFileSync(path.join(root,'.build/resources/icon.png'),png);
fs.writeFileSync(path.join(__dirname,'icon.png'),png);
