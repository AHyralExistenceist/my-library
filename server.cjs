const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const storage=require('./local-storage.cjs').createStorage();
const root=path.join(__dirname,'dist');
const routes={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.headers.host!=='127.0.0.1:4173'){res.writeHead(403);res.end();return}if(req.url?.startsWith('/api/')){storage(req,res);return}const name=routes[req.url?.split('?')[0]];if(!name){res.writeHead(404);res.end('Not found');return}res.setHeader('Content-Type',{'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[name.split('.').pop()]);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'");fs.createReadStream(path.join(root,name)).pipe(res)}).listen(4173,'127.0.0.1',()=>console.log('My Library: http://127.0.0.1:4173'));
