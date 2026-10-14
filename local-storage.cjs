const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {promisify}=require('node:util');
const run=promisify(require('node:child_process').execFile);
const FILE='my-library.json';
async function pickFolder(execute=run,platform=process.platform){
 if(platform==='darwin'){
  const script='try\nset chosenFolder to choose folder with prompt "My Library — 저장 폴더를 선택하세요"\nreturn POSIX path of chosenFolder\non error number -128\nreturn ""\nend try';
  try{const {stdout}=await execute('/usr/bin/osascript',['-e',script],{encoding:'utf8',timeout:300000});return stdout.replace(/\r?\n$/,'')||null}
  catch(e){if(e.killed)throw Error('폴더 선택 시간이 초과되었습니다. 다시 선택해 주세요.');throw Error('Mac 폴더 선택 창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.')}
 }
 if(platform!=='win32')throw Error('폴더 선택은 Windows와 Mac에서 지원합니다.');
 // Run the app's own fixed command directly; do not change Windows execution policy.
 const command=await fs.readFile(path.join(__dirname,'choose-folder.ps1'),'utf8');
 try{
  const {stdout}=await execute('powershell.exe',['-NoProfile','-STA','-Command',command],{windowsHide:true,encoding:'utf8',timeout:300000});
  return stdout.replace(/^\uFEFF/,'').trim()||null;
 }catch(e){
  if(e.killed)throw Error('폴더 선택 시간이 초과되었습니다. 다시 선택해 주세요.');
  throw Error('Windows 폴더 선택 창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.');
 }
}
async function readLibrary(directory){for(const name of [FILE,'yeobaek-library.json']){try{return await fs.readFile(path.join(directory,name),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}}return null;}
function check(content){const data=JSON.parse(content);if(!['my-library','yeobaek'].includes(data?.app)||data.version!==1||!Array.isArray(data.books))throw Error('올바른 서재 파일이 아닙니다.');}
async function atomicWrite(filename,content){const temp=filename+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,content,{flag:'wx'});await fs.rename(temp,filename)}finally{await fs.rm(temp,{force:true})}}
function createStorage({configFile=path.join(__dirname,'.local-storage.json'),picker=pickFolder}={}){
 let directory=null,selecting=false,locked=false;const candidates=new Map();
 const ready=fs.readFile(configFile,'utf8').then(raw=>{directory=JSON.parse(raw).directory||null}).catch(e=>{if(e.code!=='ENOENT')console.error('저장 위치 설정을 불러오지 못했습니다.')});
 return async function(req,res){
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
  const origin='http://127.0.0.1:'+req.socket.localPort,url=req.url.split('?')[0];
  if(req.headers.host!==new URL(origin).host||req.headers['x-library-client']!=='my-library'||(req.headers.origin&&req.headers.origin!==origin))return reply(403,{error:'이 서재 화면에서만 사용할 수 있습니다.'});
  try{
   await ready;
   if(req.method==='GET'&&url==='/api/storage')return reply(200,{directory,content:directory?await readLibrary(directory):null});
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='application/json')return reply(403,{error:'잘못된 요청입니다.'});
   let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>100*1024*1024)throw Error('서재 파일이 너무 큽니다.');chunks.push(chunk)}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
   if(url==='/api/storage/select'){
    if(selecting)return reply(409,{error:'이미 폴더 선택 창이 열려 있습니다.'});selecting=true;
    try{const selected=await picker();if(!selected)return reply(200,{cancelled:true});const selectedPath=await fs.realpath(selected);if(!(await fs.stat(selectedPath)).isDirectory())throw Error('폴더를 선택해 주세요.');const content=await readLibrary(selectedPath),token=randomUUID();if(content!==null)check(content);candidates.clear();candidates.set(token,selectedPath);return reply(200,{token,directory:selectedPath,content})}finally{selecting=false}
   }
   if(locked)return reply(409,{error:'다른 저장 작업 중입니다. 다시 시도해 주세요.'});locked=true;
   try{
    if(url==='/api/storage/connect'){
     const selected=candidates.get(input.token);if(!selected)throw Error('폴더를 다시 선택해 주세요.');
     const current=await readLibrary(selected);if(current!==input.expected)throw Error('서재 파일이 변경되었습니다. 폴더를 다시 선택해 주세요.');let content=current;
     if(input.content!==undefined){if(current!==null)throw Error('기존 서재가 있는 폴더에는 복사할 수 없습니다.');check(input.content);await atomicWrite(path.join(selected,FILE),input.content);content=input.content}
     await atomicWrite(configFile,JSON.stringify({directory:selected}));directory=selected;candidates.clear();return reply(200,{directory,content});
    }
    if(url==='/api/storage/write'){
     if(!directory||directory!==input.directory)throw Error('저장 위치가 변경되었습니다. 폴더를 다시 선택해 주세요.');
     if(await readLibrary(directory)!==input.expected)throw Error('다른 창이나 프로그램에서 기록이 변경되었습니다. 폴더를 다시 선택해 주세요.');
     check(input.content);await atomicWrite(path.join(directory,FILE),input.content);return reply(200,{saved:true});
    }
    return reply(404,{error:'Not found'});
   }finally{locked=false}
  }catch(e){reply(400,{error:e.code==='EACCES'||e.code==='EPERM'?'이 폴더에 접근할 권한이 없습니다. 다른 폴더를 선택해 주세요.':e.message})}
 };
}
module.exports={createStorage,pickFolder};
