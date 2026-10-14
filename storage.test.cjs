const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('custom shelf order persists and edits preserve order including hidden books',()=>{
 const c=setup();vm.runInContext(`globalThis.orderItems=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];globalThis.reordered=reorderShelf(orderItems,['a','c','d'],'d','a',false)`,c);
 assert.deepEqual(Array.from(c.reordered,b=>b.id),['d','b','a','c']);assert.deepEqual(Array.from(c.orderItems,b=>b.id),['a','b','c','d']);
 vm.runInContext(`globalThis.restored=JSON.parse(serialize(upsertBook(reordered,{id:'b',title:'수정'}))).books`,c);
 assert.deepEqual(Array.from(c.restored,b=>b.id),['d','b','a','c']);
 assert.deepEqual(Array.from(c.restored,b=>b.shelfOrder),[0,1,2,3]);
 assert.equal(vm.runInContext("upsertBook(restored,{id:'e'})[4].shelfOrder",c),4);
});
test('one featured sentence survives ordering and saving, and can be cleared',()=>{
 const c=setup();vm.runInContext(`quoteDrafts=[{text:'첫 문장',note:'',page:10},{text:'두 번째',note:'소감',page:null}];toggleFeaturedQuote(quoteDrafts,0);toggleFeaturedQuote(quoteDrafts,1);moveQuote(quoteDrafts,1,0);`,c);
 const saved=vm.runInContext('JSON.parse(serialize([{quotes:normalizeQuotes(quoteDrafts)}])).books[0].quotes',c);
 assert.equal(saved[0].text,'두 번째');assert.equal(saved[0].featured,true);assert.equal(saved[1].featured,undefined);
 vm.runInContext('toggleFeaturedQuote(quoteDrafts,0)',c);assert.equal(vm.runInContext('quoteDrafts.some(q=>q.featured)',c),false);
 assert.equal(vm.runInContext("toggleFeaturedQuote([{text:'',note:'',page:null}],0)",c),false);
});
test('review uses shared edit mode without losing text or line breaks',()=>{
 const c=setup();vm.runInContext(`$('#review').value='첫 줄\\n두 번째 줄';quoteEditMode=false;renderReview()`,c);
 assert.equal(vm.runInContext("$('#review').hidden",c),true);
 assert.equal(vm.runInContext("$('#review-display').textContent",c),'첫 줄\n두 번째 줄');
 vm.runInContext('quoteEditMode=true;renderReview()',c);
 assert.equal(vm.runInContext("$('#review').hidden",c),false);
 assert.equal(vm.runInContext("$('#review-display').hidden",c),true);
 vm.runInContext("$('#review').value='';quoteEditMode=false;renderReview()",c);
 assert.equal(vm.runInContext("$('#review-display').hidden",c),true);
});
test('closing waits for persistence and retains editor on failure',async()=>{
 const c=setup();
 vm.runInContext(`editing='existing';$('#title').value='책';$('#rating').value='0';$('#readPages').value='0';quoteDrafts=[];editorChanged=()=>true;updateProgress=()=>true;$('#book-form').reportValidity=()=>true;$('#editor').close=()=>{globalThis.closed=true};toast=()=>{};commit=async next=>{globalThis.saved=next;await new Promise(resolve=>{globalThis.finishWrite=resolve});return true}`,c);
 const closing=vm.runInContext('closeEditor()',c);
 assert.equal(c.closed,undefined);assert.equal(c.saved[0].title,'책');c.finishWrite();await closing;assert.equal(c.closed,true);
 c.closed=false;vm.runInContext(`commit=async()=>{throw Error('disk unavailable')}`,c);await vm.runInContext('closeEditor()',c);assert.equal(c.closed,false);
 vm.runInContext(`commit=async()=>false`,c);await vm.runInContext('closeEditor()',c);assert.equal(c.closed,false);
 vm.runInContext(`editorChanged=()=>false;commit=async()=>{throw Error('should not save')}`,c);await vm.runInContext('closeEditor()',c);assert.equal(c.closed,true);
});
test('quote drag order moves both directions and survives serialization',()=>{
 const c=setup();
 const result=vm.runInContext(`(()=>{const items=[{text:'A',note:'소감',page:1},{text:'B',note:'',page:2},{text:'C',note:'',page:null}];moveQuote(items,0,3);moveQuote(items,1,0);return JSON.parse(serialize([{quotes:normalizeQuotes(items)}])).books[0].quotes})()`,c);
 assert.deepEqual(Array.from(result,q=>q.text),['C','B','A']);assert.equal(result[2].note,'소감');assert.equal(result[2].page,1);
 assert.equal(vm.runInContext('moveQuote([1,2],0,1)',c),false);
});
test('Done persists edits before leaving quote edit mode; failed save retains edits',async()=>{
 const c=setup();
 vm.runInContext(`editing='existing';quoteEditMode=true;quoteDrafts=[{text:'문장',note:'소감',page:12}];$('#title').value='책';$('#rating').value='0';$('#totalPages').value='';$('#readPages').value='0';updateProgress=()=>true;renderQuotes=()=>{};toast=()=>{};commit=async next=>{globalThis.saved=next;return true};`,c);
 await vm.runInContext(`$('#book-form').onsubmit({preventDefault(){},submitter:{id:'edit-quotes',dataset:{}}})`,c);
 assert.equal(c.saved[0].quotes[0].text,'문장');assert.equal(vm.runInContext('quoteEditMode',c),false);
 vm.runInContext(`quoteEditMode=true;quoteDrafts[0].text='수정 중';commit=async()=>{throw Error('write failed')}`,c);
 await vm.runInContext(`$('#book-form').onsubmit({preventDefault(){},submitter:{id:'edit-quotes',dataset:{}}})`,c);
 assert.equal(vm.runInContext('quoteEditMode',c),true);assert.equal(vm.runInContext('quoteDrafts[0].text',c),'수정 중');assert.equal(vm.runInContext('busy',c),false);
});
test('memorable sentences preserve optional notes and pages through saving',()=>{
 const c=setup();
 const result=vm.runInContext(`JSON.parse(serialize([{quotes:normalizeQuotes([{text:'문장만',note:'',page:''},{text:'두 번째 문장',note:'나의 소감',page:'42'}])}])).books[0].quotes`,c);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[{text:'문장만',note:'',page:null},{text:'두 번째 문장',note:'나의 소감',page:42}]);
 assert.equal(vm.runInContext("normalizeQuotes([{text:'',note:'',page:''}]).length",c),0);
 for(const item of [{text:'',note:'소감',page:''},{text:'문장',note:'',page:-1},{text:'문장',note:'',page:1.5}]){c.quoteFixture=item;assert.throws(()=>vm.runInContext('normalizeQuotes([quoteFixture])',c))}
});
test('reading progress handles unknown totals, decimals and invalid counts',()=>{const c=setup();assert.equal(vm.runInContext('progressPercent(300,100)',c),33.3);assert.equal(vm.runInContext('progressPercent(300,300)',c),100);assert.equal(vm.runInContext('progressPercent(300,0)',c),0);assert.equal(vm.runInContext('progressPercent(null,0)',c),null);for(const pair of ['0,0','100,101','100,-1','100,1.5'])assert.equal(vm.runInContext(`validPages(${pair})`,c),false)});
test('publisher and page counts round trip with legacy support',()=>{const c=setup();const base={id:'1',title:'책',author:'작가',review:'기록',cover:'',status:'reading',rating:0,date:'2026-10-14',updatedAt:'2026-10-14'};c.fixture={app:'my-library',version:1,books:[{...base,publisher:'출판사',totalPages:400,readPages:125},{...base,id:'2'}]};const result=vm.runInContext('validate(JSON.parse(serialize(validate(fixture))))',c);assert.equal(result[0].publisher,'출판사');assert.equal(result[0].totalPages,400);assert.equal(result[0].readPages,125);assert.equal(result.length,2);c.fixture.books[0].readPages=401;assert.throws(()=>vm.runInContext('validate(fixture)',c))});
function setup(){const nodes=new Map();const node=()=>({value:'',style:{},classList:{toggle(){}},replaceChildren(){},addEventListener(){},append(){},setAttribute(){},removeAttribute(){}});const context=vm.createContext({document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return []},createElement:node},window:{addEventListener(){}},setTimeout,clearTimeout,console});vm.runInContext(fs.readFileSync(__dirname+'/dist/app.js','utf8'),context);return context}
test('records, review and cover survive serialization',()=>{const c=setup();const result=vm.runInContext(`validate(JSON.parse(serialize([{id:'1',title:'책',author:'작가',review:'첫 줄\\n둘째 줄',cover:'data:image/png;base64,aGVsbG8=',status:'done',rating:5,date:'2026-10-14',updatedAt:'2026-10-14'}])))`,c);assert.equal(result[0].review,'첫 줄\n둘째 줄');assert.equal(result[0].cover,'data:image/png;base64,aGVsbG8=')});
test('invalid backup and unsafe cover rejected',()=>{const c=setup();assert.throws(()=>vm.runInContext(`validate({app:'other',version:1,books:[]})`,c));assert.throws(()=>vm.runInContext(`validate({app:'yeobaek',version:1,books:[{id:'1'}]})`,c))});
test('folder writes round trip and external changes block overwrite',async()=>{const c=setup();await vm.runInContext(`(async()=>{let disk=null;folder={async getFileHandle(name,opts){if(disk===null&&!opts?.create){const e=new Error();e.name='NotFoundError';throw e}return {async getFile(){return {async text(){return disk}}},async createWritable(){let next;return {async write(text){next=text},async close(){disk=next},async abort(){}}}}}};await writeFolder([]);if((await readFolder(folder))!==revision)throw Error('round trip failed');disk='external edit';let blocked=false;try{await writeFolder([])}catch{blocked=true}if(!blocked||disk!=='external edit')throw Error('overwritten')})()`,c)});
