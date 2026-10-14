const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createStorage,pickFolder:nativePickFolder}=require('./local-storage.cjs');
const pickFolder=execute=>nativePickFolder(execute,'win32');
test('Mac picker returns full paths, handles cancellation and failures',async()=>{
 const result=await nativePickFolder(async(command,args)=>{
  assert.equal(command,'/usr/bin/osascript');assert.equal(args[0],'-e');assert.match(args[1],/choose folder/);assert.match(args[1],/on error number -128/);
  return {stdout:'/Users/reader/Documents/내 서재/\n'};
 },'darwin');
 assert.equal(result,'/Users/reader/Documents/내 서재/');
 assert.equal(await nativePickFolder(async()=>({stdout:'\n'}),'darwin'),null);
 await assert.rejects(nativePickFolder(async()=>{throw Error('failure')},'darwin'),/Mac 폴더 선택/);
});
test('picker uses a direct command and preserves Korean paths',async()=>{
 const selected=await pickFolder(async(executable,args,options)=>{
  assert.equal(executable,'powershell.exe');
  assert.ok(args.includes('-Command'));assert.ok(!args.includes('-File'));
  assert.ok(!args.includes('-ExecutionPolicy'));
  assert.equal(options.encoding,'utf8');
  return {stdout:'C:\\Users\\사용자\\문서\\내 서재\r\n'};
 });
 assert.equal(selected,'C:\\Users\\사용자\\문서\\내 서재');
 assert.equal(await pickFolder(async()=>({stdout:''})),null);
 await assert.rejects(pickFolder(async()=>{throw Error('Command failed: private raw command')}),{message:'Windows 폴더 선택 창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.'});
});
test('native folder path, persistence, save, conflict and origin protection',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'my-library-test-'));
 const configFile=path.join(root,'config.json'),directory=path.join(root,'서재');await fs.mkdir(directory);
 const servers=[];
 async function start(picker){const server=http.createServer(createStorage({configFile,picker}));servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;return async(route='',body,extra={})=>{const response=await fetch(origin+'/api/storage'+route,{method:body===undefined?'GET':'POST',headers:{'X-Library-Client':'my-library',...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}}
 try{
  const request=await start(async()=>directory);
  assert.equal((await request()).data.directory,null);
  assert.equal((await request('/select',{}, {Origin:'https://other.example'})).status,403);
  assert.equal((await request('',undefined,{'X-Library-Client':''})).status,403);
  const selected=(await request('/select',{})).data;
  assert.equal(selected.content,null);
  assert.equal(selected.directory,await fs.realpath(directory));
  const connected=(await request('/connect',{token:selected.token,expected:null})).data;
  assert.equal(connected.directory,selected.directory);
  assert.equal(connected.content,null);
  const content=JSON.stringify({app:'my-library',version:1,books:[]});
  assert.equal((await request('/write',{directory:connected.directory,expected:null,content})).status,200);
  assert.equal(await fs.readFile(path.join(directory,'my-library.json'),'utf8'),content);
  assert.equal((await request('/write',{directory:connected.directory,expected:null,content})).status,400);
  const restored=await start(async()=>null);
  assert.equal((await restored()).data.directory,connected.directory);
  assert.equal((await restored()).data.content,content);
  assert.equal((await restored('/select',{})).data.cancelled,true);
  assert.equal((await restored()).data.directory,connected.directory);
 }finally{for(const server of servers)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true})}
});
