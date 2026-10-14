const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMobileServer}=require('./server-mobile.cjs');
test('mobile serves device storage app but never exposes desktop data or API',async()=>{
 const server=createMobileServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/data-storage="device"/);
  for(const route of ['/api/storage','/.local-storage.json','/my-library.json','/../local-storage.cjs'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await fetch(base+'/app.js')).status,200);
  assert.equal((await fetch(base+'/',{method:'POST'})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
