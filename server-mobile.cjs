const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
function createMobileServer(){
 const routes={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js'};
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  const file=routes[req.url?.split('?')[0]];
  if(req.method!=='GET'||!file){res.writeHead(404);res.end('Not found');return}
  try{
   let content=await fs.readFile(path.join(__dirname,'dist',file),'utf8');
   if(file==='index.html')content=content.replace('<html lang="ko">','<html lang="ko" data-storage="device">');
   res.setHeader('Content-Type',{'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[file.split('.').pop()]);res.end(content);
  }catch{res.writeHead(500);res.end('Unable to load app')}
 });
}
if(require.main===module){
 createMobileServer().listen(4180,'0.0.0.0',()=>{
  console.log('My Library mobile — iPhone/iPad를 같은 Wi-Fi에 연결하고 아래 주소를 Safari에서 여세요.');
  for(const entries of Object.values(os.networkInterfaces()))for(const entry of entries||[])if(entry.family==='IPv4'&&!entry.internal)console.log('http://'+entry.address+':4180');
  console.log('화면 파일만 제공합니다. 기록은 접속한 기기에 저장되며 PC의 서재 파일은 공개되지 않습니다.');
 });
}
module.exports={createMobileServer};
