const $=s=>document.querySelector(s);
const FILE='my-library.json';
const LEGACY_FILE='yeobaek-library.json';
const deviceStorage=document.documentElement?.dataset.storage==='device';
let deviceReady=false;
function newBookId(){return typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}
function deviceLibrary(content,expected){
 return new Promise((resolve,reject)=>{
  const opening=indexedDB.open('my-library-device',1);
  opening.onupgradeneeded=()=>opening.result.createObjectStore('records');
  opening.onerror=()=>reject(Error('기기 저장 공간을 열 수 없습니다. 일반 브라우징 모드에서 다시 시도해 주세요.'));
  opening.onblocked=()=>reject(Error('다른 서재 탭을 닫고 다시 시도해 주세요.'));
  opening.onsuccess=()=>{
   const db=opening.result,tx=db.transaction('records',content===undefined?'readonly':'readwrite'),store=tx.objectStore('records');let value=null,error;
   const read=store.get('library');
   read.onsuccess=()=>{value=read.result??null;if(content!==undefined){if(value!==expected){error=Error('다른 창에서 기록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');tx.abort();return}store.put(content,'library');value=content}};
   tx.oncomplete=()=>{db.close();resolve(value)};
   tx.onabort=tx.onerror=()=>{db.close();reject(error||Error('기기에 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'))};
  };
 });
}
const labels={reading:'읽고 있어요',done:'다 읽었어요',wish:'읽고 싶어요'};
const colors=['#74816a','#a0856b','#6d8287','#92836d','#7c766e'];
let books=[],folder=null,revision=null,filter='all',editing=null,cover='',dirty=false,busy=false;
let toastTimer;
let draggedBookId=null,bookDragUntil=0;
function customBooks(items){return items.map((book,index)=>({book,order:book.shelfOrder??index})).sort((a,b)=>a.order-b.order).map(item=>item.book)}
function reorderShelf(items,visibleIds,fromId,toId,after){
 const ordered=customBooks(items),ids=visibleIds.filter(id=>id!==fromId),target=ids.indexOf(toId);
 if(fromId===toId||target<0||!visibleIds.includes(fromId))return items;
 ids.splice(target+(after?1:0),0,fromId);
 const visible=new Set(visibleIds),byId=new Map(items.map(book=>[book.id,book]));let cursor=0;
 return ordered.map((book,index)=>({... (visible.has(book.id)?byId.get(ids[cursor++]):book),shelfOrder:index}));
}
function upsertBook(items,book){
 const ordered=customBooks(items).map((item,index)=>({...item,shelfOrder:index}));
 const index=ordered.findIndex(item=>item.id===book.id);
 if(index<0)ordered.push({...book,shelfOrder:ordered.length});else ordered[index]={...book,shelfOrder:index};
 return ordered;
}
function clearBookDrag(){draggedBookId=null;$('#shelf').classList.remove('book-drag-active');document.querySelectorAll('.book').forEach(book=>book.classList.remove('book-dragging','book-drop-before','book-drop-after'))}
function enableBookDrag(button,book,visibleIds){
 button.draggable=$('#sort').value==='custom';
 button.ondragstart=e=>{if(!button.draggable||busy){e.preventDefault();return}draggedBookId=book.id;bookDragUntil=Date.now()+300;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',book.id);e.dataTransfer.setDragImage(button,20,20);button.classList.add('book-dragging');$('#shelf').classList.add('book-drag-active')};
 button.ondragover=e=>{if(!draggedBookId||busy)return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.book').forEach(b=>b.classList.remove('book-drop-before','book-drop-after'));const rect=button.getBoundingClientRect();button.classList.add(e.clientX<rect.left+rect.width/2?'book-drop-before':'book-drop-after')};
 button.ondragleave=e=>{if(!button.contains(e.relatedTarget))button.classList.remove('book-drop-before','book-drop-after')};
 button.ondrop=async e=>{
  if(!draggedBookId||busy)return;e.preventDefault();const rect=button.getBoundingClientRect();const next=reorderShelf(books,visibleIds,draggedBookId,book.id,e.clientX>=rect.left+rect.width/2);clearBookDrag();bookDragUntil=Date.now()+300;if(next===books)return;
  busy=true;$('#sort').disabled=true;
  try{if(await commit(next))toast('책 순서를 저장했습니다.')}catch(error){toast('순서를 저장하지 못했습니다. '+error.message)}finally{busy=false;$('#sort').disabled=false}
 };
 button.ondragend=()=>{clearBookDrag();bookDragUntil=Date.now()+300};
}
let coverLoading=false;
let quoteDrafts=[];
let quoteEditMode=false;
let draggedQuote=null;
let quoteDragImage=null;
function setQuoteDragImage(event,card){
 quoteDragImage?.remove();
 const bounds=card.getBoundingClientRect();
 quoteDragImage=card.cloneNode(true);
 quoteDragImage.classList.add('quote-drag-image');
 quoteDragImage.draggable=false;
 quoteDragImage.setAttribute('aria-hidden','true');
 Object.assign(quoteDragImage.style,{position:'fixed',left:'-10000px',top:'0',width:`${bounds.width}px`,height:`${bounds.height}px`,margin:'0',pointerEvents:'none',overflow:'hidden',contain:'paint'});
 document.body.append(quoteDragImage);
 event.dataTransfer.setDragImage(quoteDragImage,Math.max(0,Math.min(bounds.width,event.clientX-bounds.left)),Math.max(0,Math.min(bounds.height,event.clientY-bounds.top)));
}
function moveQuote(items,from,slot){
 if(!Number.isInteger(from)||!Number.isInteger(slot)||from<0||from>=items.length||slot<0||slot>items.length)return false;
 const to=slot>from?slot-1:slot;
 if(from===to)return false;
 const [item]=items.splice(from,1);items.splice(to,0,item);return true;
}
function clearQuoteDrag(){
 quoteDragImage?.remove();quoteDragImage=null;
 document.querySelectorAll('.quote-card').forEach(card=>card.classList.remove('dragging','drop-before','drop-after'));
 draggedQuote=null;
}
function normalizeQuotes(items){
 if(!Array.isArray(items))throw Error('문장 기록 형식이 올바르지 않습니다.');
 if(items.filter(q=>q?.featured===true).length>1)throw Error('카드에 표시할 문장은 하나만 선택해 주세요.');
 return items.flatMap(q=>{
  if(!q||typeof q.text!=='string'||typeof q.note!=='string')throw Error('문장과 소감은 글자로 입력해 주세요.');
  const text=q.text.trim(),note=q.note.trim(),page=q.page===''||q.page==null?null:Number(q.page);
  if(!text&&!note&&page===null)return [];
  if(!text)throw Error('소감이나 페이지를 남기려면 문장을 먼저 입력해 주세요.');
  if(page!==null&&(!Number.isSafeInteger(page)||page<1))throw Error('문장 페이지는 1 이상의 정수로 입력해 주세요.');
  if(q.featured!==undefined&&typeof q.featured!=='boolean')throw Error('문장 별표 형식이 올바르지 않습니다.');
  return [{text,note,page,...(q.featured?{featured:true}:{})}];
 });
}
function toggleFeaturedQuote(items,index){
 if(!items[index]?.text.trim())return false;
 const selected=items[index].featured===true;
 items.forEach(q=>{delete q.featured});
 if(!selected)items[index].featured=true;
 return true;
}
function renderBookFields(){
 $('#book-heading-inputs').hidden=!quoteEditMode;
 $('#book-heading-title').hidden=quoteEditMode;
 $('#book-heading-title').textContent=$('#title').value.trim();
 $('#book-heading-author').textContent=$('#author').value.trim();
 $('#book-heading-author').hidden=quoteEditMode||!$('#author').value.trim();
 for(const id of ['title','author','translator','publisher','totalPages','readPages','status','rating','date']){
  const input=$('#'+id),display=$('#'+id+'-display');
  input.hidden=!quoteEditMode;display.hidden=quoteEditMode;
  let value=input.value;
  if(id==='status')value=labels[value]||'—';
  else if(id==='rating')value=Number(value)>0?'★'.repeat(Number(value)):'—';
  else if(id==='totalPages'||id==='readPages')value=value!==''?`${value}쪽`:'—';
  display.textContent=value||'—';
 }
}
function renderReview(){
 $('#review').hidden=!quoteEditMode;
 $('#review-display').hidden=quoteEditMode||!$('#review').value.trim();
 $('#review-display').textContent=$('#review').value;
}
function renderQuotes(){
 renderBookFields();
 renderReview();
 $('#edit-quotes').textContent=quoteEditMode?'-complete':'-edit';
 $('#edit-quotes').setAttribute('aria-pressed',String(quoteEditMode));
 $('#quote-list').replaceChildren();
 quoteDrafts.forEach((q,index)=>{
  const card=document.createElement('article');card.className='quote-card';
  const feature=document.createElement('button');feature.type='button';feature.className='quote-feature';feature.hidden=!quoteEditMode;
  const refreshFeature=()=>{feature.textContent=q.featured?'★':'☆';feature.setAttribute('aria-pressed',String(!!q.featured));feature.setAttribute('aria-label',q.featured?'카드에 표시할 문장 선택 해제':'카드에 표시할 문장으로 선택');feature.title=q.featured?'카드에 표시 중':'카드에 표시';card.classList.toggle('has-feature-control',quoteEditMode)};
  refreshFeature();
  feature.onclick=()=>{if(busy)return;if(!toggleFeaturedQuote(quoteDrafts,index)){toast('문장을 먼저 입력해 주세요.');return}document.querySelectorAll('.quote-feature').forEach((button,i)=>{const selected=!!quoteDrafts[i].featured;button.textContent=selected?'★':'☆';button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',selected?'카드에 표시할 문장 선택 해제':'카드에 표시할 문장으로 선택');button.title=selected?'카드에 표시 중':'카드에 표시'})};
  card.append(feature);
  if(quoteEditMode){const controls=document.createElement('div');controls.className='touch-quote-order';for(const [label,direction] of [['↑',-1],['↓',1]]){const move=document.createElement('button');move.type='button';move.textContent=label;move.setAttribute('aria-label',direction<0?'문장을 위로 이동':'문장을 아래로 이동');move.disabled=index+direction<0||index+direction>=quoteDrafts.length;move.onclick=()=>{if(busy)return;if(moveQuote(quoteDrafts,index,direction<0?index-1:index+2))renderQuotes()};controls.append(move)}card.append(controls)}

  card.draggable=quoteEditMode;
  card.classList.toggle('reorderable',quoteEditMode);
  card.onpointerdown=e=>{card.draggable=quoteEditMode&&!busy&&!e.target.closest('details,input,textarea,button')};
  card.ondragstart=e=>{if(!quoteEditMode||busy||!card.draggable){e.preventDefault();return}e.stopPropagation();window.getSelection()?.removeAllRanges();draggedQuote=index;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(index));card.classList.add('dragging');setQuoteDragImage(e,card)};
  card.ondragover=e=>{if(draggedQuote===null||!quoteEditMode||busy)return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.quote-card').forEach(c=>c.classList.remove('drop-before','drop-after'));const box=card.getBoundingClientRect();card.classList.add(e.clientY<box.top+box.height/2?'drop-before':'drop-after')};
  card.ondragleave=e=>{if(!card.contains(e.relatedTarget))card.classList.remove('drop-before','drop-after')};
  card.ondrop=e=>{if(draggedQuote===null||!quoteEditMode||busy)return;e.preventDefault();const box=card.getBoundingClientRect(),slot=index+(e.clientY>=box.top+box.height/2?1:0);const changed=moveQuote(quoteDrafts,draggedQuote,slot);clearQuoteDrag();if(changed)renderQuotes()};
  card.ondragend=clearQuoteDrag;
  const sentence=document.createElement('p');sentence.className='quote-sentence';
  const words=document.createElement('span'),pageLabel=document.createElement('small');pageLabel.className='quote-page';sentence.append(words,pageLabel);
  const noteView=document.createElement('p');noteView.className='quote-note';
  const details=document.createElement('details');details.className='quote-fields';details.open=!q.text;details.hidden=!quoteEditMode&&!!q.text;
  const summary=document.createElement('summary');summary.textContent='문장 수정';summary.hidden=!quoteEditMode;details.append(summary);
  function field(label,key,type){const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement(type==='number'?'input':'textarea');if(type==='number'){input.type='number';input.min='1';input.step='1';input.placeholder='선택'}else{input.rows=key==='text'?3:2;input.placeholder=key==='text'?'기억하고 싶은 문장을 입력하세요':'소감을 남겨 주세요'}input.value=q[key]??'';input.oninput=()=>{q[key]=input.value;update()};wrapper.append(input);details.append(wrapper);return input}
  field('문장','text');field('페이지 (선택)','page','number');field('소감 (선택)','note');
  const remove=document.createElement('button');remove.type='button';remove.className='text-button quote-remove';remove.textContent='삭제';remove.onclick=()=>{quoteDrafts.splice(index,1);renderQuotes()};const actions=document.createElement('div');actions.className='quote-actions';actions.append(remove);details.append(actions);
  function update(){words.textContent=q.text||'문장을 입력하세요';pageLabel.textContent=q.page?` p. ${q.page}`:'';pageLabel.hidden=!q.page;noteView.textContent=q.note;noteView.hidden=!q.note.trim()}
  update();card.append(sentence,noteView,details);$('#quote-list').append(card);
 });
}
$('#edit-quotes').onclick=e=>{if(busy){e.preventDefault();return}if(!quoteEditMode){e.preventDefault();quoteEditMode=true;renderQuotes()}};
$('#add-quote').onclick=()=>{quoteDrafts.push({text:'',note:'',page:''});renderQuotes();$('#quote-list').lastElementChild.querySelector('textarea').focus()};
function validPages(total,read){return (total===null||(Number.isSafeInteger(total)&&total>0))&&Number.isSafeInteger(read)&&read>=0&&(total===null||read<=total)}
function progressPercent(total,read){return total!==null&&validPages(total,read)?Math.round(read/total*1000)/10:null}
function updateProgress(){
 const total=$('#totalPages').value===''?null:Number($('#totalPages').value),read=Number($('#readPages').value);
 const valid=validPages(total,read)&&!$('#totalPages').validity?.badInput&&!$('#readPages').validity?.badInput;
 $('#readPages').setCustomValidity(valid?'':'쪽수는 정수로 입력하고, 읽은 쪽수는 0 이상 전체 쪽수 이하로 입력하세요.');
 const percent=valid?progressPercent(total,read):null;
 $('#progress-text').textContent=!valid?'쪽수를 확인하세요':percent===null?'전체 쪽수를 입력하세요':`${percent}% · ${read} / ${total}쪽`;
 $('#reading-progress').value=percent??0;
 $('#reading-progress').textContent=percent===null?'진행도 미정':`${percent}%`;
 return valid;
}
$('#totalPages').oninput=$('#readPages').oninput=updateProgress;
function toast(message){
 const notice=$('#toast');
 clearTimeout(toastTimer);
 notice.textContent=message;
 notice.style.display='block';
 if(typeof notice.showPopover==='function'){
  if(notice.matches(':popover-open'))notice.hidePopover();
  notice.showPopover();
 }else{
  const dialogs=document.querySelectorAll('dialog[open]');
  (dialogs[dialogs.length-1]||document.body).append(notice);
 }
 toastTimer=setTimeout(()=>{
  if(typeof notice.hidePopover==='function'&&notice.matches(':popover-open'))notice.hidePopover();
  notice.style.display='none';
 },2000);
}
function validate(data){
 if(!['my-library','yeobaek'].includes(data?.app)||data.version!==1||!Array.isArray(data.books))throw Error('My Library 서재 파일이 아닙니다. 원본 파일은 변경하지 않았습니다.');
 const ids=new Set();
 for(const b of data.books){if(!b||typeof b.id!=='string'||ids.has(b.id)||typeof b.title!=='string'||!b.title.trim()||typeof b.author!=='string'||typeof b.review!=='string'||typeof b.cover!=='string'||!Object.hasOwn(labels,b.status)||!Number.isInteger(b.rating)||b.rating<0||b.rating>5||typeof b.date!=='string'||typeof b.updatedAt!=='string'||(b.cover&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.cover)))throw Error('서재 파일의 형식을 확인해 주세요. 불러오기를 취소했습니다.');if((b.publisher!==undefined&&typeof b.publisher!=='string')||!validPages(b.totalPages??null,b.readPages??0))throw Error('출판사 또는 쪽수 형식이 올바르지 않습니다.');if(b.translator!==undefined&&typeof b.translator!=='string')throw Error('옮긴 이 형식이 올바르지 않습니다.');if(b.shelfOrder!==undefined&&(!Number.isSafeInteger(b.shelfOrder)||b.shelfOrder<0))throw Error('책 순서 형식이 올바르지 않습니다.');if(b.quotes!==undefined)normalizeQuotes(b.quotes);ids.add(b.id)}
 return data.books;
}
function serialize(items){return JSON.stringify({app:'my-library',version:1,updatedAt:new Date().toISOString(),books:items},null,2)}
async function readFolder(handle){
 for(const name of [FILE,LEGACY_FILE]){
  try{return await (await (await handle.getFileHandle(name)).getFile()).text()}
  catch(e){if(e.name!=='NotFoundError')throw e}
 }
 return null;
}
async function writeFolder(items){
 if(deviceStorage){if(!deviceReady)throw Error('기기 저장 공간이 아직 연결되지 않았습니다.');const text=serialize(items);await deviceLibrary(text,revision);revision=text;return;}
 if(folder?.native){
  const text=serialize(items);
  await storageApi('/write',{directory:folder.path,expected:revision,content:text});
  revision=text;
  return;
 }
 const current=await readFolder(folder);
 if(current!==revision)throw Error('다른 창이나 프로그램에서 서재 파일이 변경되었습니다. 기록을 복사한 뒤 저장 폴더를 다시 열어 주세요.');
 const text=serialize(items),handle=await folder.getFileHandle(FILE,{create:true});
 const writer=await handle.createWritable();
 try{await writer.write(text);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}
 revision=text;
}
function render(){
 for(const key of ['reading','done','wish'])$('#'+key).textContent=books.filter(b=>b.status===key).length;
 $('#total').textContent=books.length;
 const q=$('#search').value.trim().toLocaleLowerCase();
 const customOrder=new Map(customBooks(books).map((b,i)=>[b.id,i]));
 const visible=books.filter(b=>(filter==='all'||b.status===filter)&&[b.title,b.author,b.review].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>$('#sort').value==='custom'?customOrder.get(a.id)-customOrder.get(b.id):$('#sort').value==='title'?a.title.localeCompare(b.title,'ko'):$('#sort').value==='rating'?b.rating-a.rating:b.updatedAt.localeCompare(a.updatedAt));
 $('#shelf').replaceChildren();
 visible.forEach(b=>{const button=document.createElement('button');button.className='book';button.setAttribute('aria-label',b.title+' 기록 열기');const art=document.createElement('div');art.className='book-cover';art.style.setProperty('--cover',colors[[...b.id].reduce((n,c)=>n+c.charCodeAt(0),0)%colors.length]);
 if(b.cover){const img=document.createElement('img');img.onload=()=>{if(img.naturalWidth&&img.naturalHeight)art.style.aspectRatio=`${img.naturalWidth} / ${img.naturalHeight}`};img.src=b.cover;img.alt=b.title+' 표지';art.append(img)}else{const heading=document.createElement('div');heading.className='fallback-cover-heading';const title=document.createElement('strong');title.textContent=b.title;const author=document.createElement('small');author.className='fallback-cover-author';author.textContent=b.author||'';heading.append(title,author);const publisher=document.createElement('small');publisher.textContent=b.publisher||'';art.append(heading,publisher)}
 const title=document.createElement('strong');title.className='book-title';title.textContent=b.title;const author=document.createElement('span');author.className='book-author';author.textContent=b.author||'작가 미입력';const meta=document.createElement('div');meta.className='book-meta';const status=document.createElement('span');const progress=b.status==='reading'?progressPercent(b.totalPages??null,b.readPages??0):null;status.textContent=labels[b.status]+(progress===null?'':` (${progress}%)`);const stars=document.createElement('span');stars.className='stars';stars.textContent='★'.repeat(b.rating);meta.append(status,stars);const info=document.createElement('span');info.className='book-info-panel';info.append(title,author,meta);const featured=(b.quotes||[]).find(q=>q.featured&&q.text.trim());if(featured){const excerpt=document.createElement('span');excerpt.className='book-featured-quote';excerpt.textContent=featured.text;excerpt.title=featured.text+(featured.page?' · p. '+featured.page:'');info.append(excerpt);if(featured.page){const page=document.createElement('small');page.className='book-featured-page';page.textContent='p. '+featured.page;info.append(page)}}const volume=document.createElement('div');volume.className='book-volume';const back=document.createElement('div');back.className='book-back-cover';back.setAttribute('aria-hidden','true');back.style.backgroundColor=art.style.getPropertyValue('--cover');if(b.cover){const backImage=document.createElement('img');backImage.src=b.cover;backImage.alt='';backImage.draggable=false;back.append(backImage)}const pages=document.createElement('div');pages.className='book-page-block';pages.setAttribute('aria-hidden','true');volume.append(back,pages,art);button.append(volume,info);art.querySelectorAll('img').forEach(img=>img.draggable=false);enableBookDrag(button,b,visible.map(item=>item.id));button.onclick=()=>{if(!busy&&Date.now()>bookDragUntil)openEditor(b)};$('#shelf').append(button)});
 $('#empty').hidden=visible.length>0;$('#empty h3').textContent=books.length?'아직 이 칸에 놓인 책이 없어요':'당신의 첫 번째 책을 기다립니다';$('#empty p').innerHTML=books.length?'검색어나 독서 상태를 바꾸거나 새 책을 추가해 보세요.':'오늘 읽은 한 문장부터 시작해 보세요.<br>표지와 함께, 오래 간직할 기록을 남겨요.';
 $('#folder-name').textContent=folder?(folder.path||folder.name):'아직 선택하지 않았어요';
 $('#folder-note').textContent=folder?`저장 파일: ${FILE} · 기록 저장 시 이 폴더에 저장합니다.`:'기존 기록이 있는 폴더를 선택하면 그 서재를 엽니다.';
 $('#choose-folder').textContent=folder?'저장 폴더 변경 / 다른 서재 열기':'폴더 선택 / 다른 서재 열기';
 $('#save-state').textContent=folder?'● '+folder.name+' · 폴더에 저장':dirty?'● 파일 내려받기가 필요합니다':'저장 폴더를 선택해 시작하세요';
 if(deviceStorage){
  $('#folder-name').textContent=deviceReady?'이 기기의 브라우저 저장 공간':'저장 공간 연결 필요';
  $('#folder-note').textContent='기록과 표지는 이 기기에 저장됩니다. 파일로 내보내면 파일 앱에서도 보관할 수 있습니다.';
  $('#choose-folder').hidden=true;
  $('#save-state').textContent=deviceReady?'● 이 기기에 저장':'기기 저장 공간 연결 필요';
 }
}
function preview(){ $('#cover-preview').hidden=!cover;$('#cover-hint').hidden=!!cover;if(cover)$('#cover-preview').src=cover;else $('#cover-preview').removeAttribute('src') }
function openEditor(book){editing=book?.id||null;$('#book-form').reset();quoteEditMode=!book;quoteDrafts=(book?.quotes||[]).map(q=>({...q}));renderQuotes();cover=book?.cover||'';for(const key of ['title','author','translator','publisher','review'])$('#'+key).value=book?.[key]||'';$('#totalPages').value=book?.totalPages??'';$('#readPages').value=book?.readPages??0;updateProgress();$('#status').value=book?.status||'reading';$('#rating').value=book?.rating||0;const now=new Date();$('#date').value=book?.date||new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,10);$('#delete').hidden=!book;renderBookFields();renderReview();preview();$('#editor').showModal()}
async function closeEditor(){if(busy||coverLoading)return;if(!editorChanged()){$('#editor').close();return}if(!$('#book-form').reportValidity())return;await saveEditor(false)}
function editorChanged(){const b=books.find(b=>b.id===editing);return JSON.stringify(quoteDrafts)!==JSON.stringify(b?.quotes||[])||['title','author','translator','publisher','review'].some(k=>$('#'+k).value!==(b?.[k]||''))||$('#totalPages').value!==String(b?.totalPages??'')||Number($('#readPages').value)!==(b?.readPages??0)||cover!==(b?.cover||'')||$('#status').value!==(b?.status||'reading')||Number($('#rating').value)!==(b?.rating||0)||(!!b&&$('#date').value!==b.date)}
async function commit(next){if(folder||deviceStorage){await writeFolder(next);dirty=false}else{if(!confirm('저장 폴더가 아직 없습니다. 이번 기록을 파일로 내려받을까요? 다음에는 설정에서 파일을 가져올 수 있습니다.'))return false;download(next);dirty=false}books=next;render();return true}
function download(items=books){const blob=new Blob([serialize(items)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=FILE;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
$('#book-form').onsubmit=async e=>{e.preventDefault();await saveEditor(e.submitter?.id==='edit-quotes')};
async function saveEditor(keepOpen=false){if(busy||coverLoading)return;if(!$('#title').value.trim()){toast('책 제목을 입력해 주세요.');return}if(!updateProgress()){ $('#readPages').reportValidity();return }let quotes;try{quotes=normalizeQuotes(quoteDrafts)}catch(error){toast(error.message);return}busy=true;$('#close-editor').disabled=true;$('#edit-quotes').disabled=true;$('#add-quote').disabled=true;const b={id:editing||newBookId(),title:$('#title').value.trim(),author:$('#author').value.trim(),translator:$('#translator').value.trim(),publisher:$('#publisher').value.trim(),totalPages:$('#totalPages').value===''?null:Number($('#totalPages').value),readPages:Number($('#readPages').value),review:$('#review').value,quotes,cover,status:$('#status').value,rating:Number($('#rating').value),date:$('#date').value,updatedAt:new Date().toISOString()};try{if(await commit(upsertBook(books,b))){if(keepOpen){editing=b.id;quoteEditMode=false;quoteDrafts=quotes.map(q=>({...q}));renderQuotes();$('#delete').hidden=false;toast(deviceStorage?'이 기기에 저장했습니다.':folder?'문장과 책 기록을 저장했습니다.':'기록 파일을 내려받았습니다. 다운로드 완료를 확인해 주세요.')}else{$('#editor').close();toast(deviceStorage?'이 기기에 저장했습니다.':folder?'기록과 표지를 폴더에 저장했습니다.':'기록 파일을 내려받았습니다. 다운로드 완료를 확인해 주세요.')}}}catch(e){toast('저장하지 못했습니다. '+e.message)}finally{busy=false;$('#close-editor').disabled=false;$('#edit-quotes').disabled=false;$('#add-quote').disabled=false}};
$('#cover').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){toast('10MB 이하의 JPG, PNG, WEBP 이미지를 선택해 주세요.');e.target.value='';return}coverLoading=true;$('#close-editor').disabled=true;try{const bitmap=await createImageBitmap(file),scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);cover=canvas.toDataURL('image/webp',.88);bitmap.close();preview()}catch{toast('이미지를 열 수 없습니다. 다른 파일을 선택해 주세요.')}finally{coverLoading=false;$('#close-editor').disabled=false}};
$('#remove-cover').onclick=()=>{cover='';$('#cover').value='';preview()};
$('#delete').onclick=()=>{
 if(busy||coverLoading||!editing)return;
 const bookTitle=$('#title').value.trim()||'이 책';
 const last=bookTitle.charCodeAt(bookTitle.length-1);
 const particle=last>=0xAC00&&last<=0xD7A3?((last-0xAC00)%28===0?'를':'을'):'을/를';
 $('#delete-description').textContent=`‘${bookTitle}’${particle} 책장에서 삭제할까요?`;
 $('#delete-error').textContent='';
 $('#delete-confirmation').showModal();
};
$('#cancel-delete').onclick=()=>{if(!busy)$('#delete-confirmation').close()};
$('#delete-confirmation').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('#confirm-delete').onclick=async()=>{
 if(busy||!editing)return;
 busy=true;$('#confirm-delete').disabled=true;$('#cancel-delete').disabled=true;
 try{
  if(await commit(books.filter(b=>b.id!==editing))){
   $('#delete-confirmation').close();$('#editor').close();toast('책을 삭제했습니다.');
  }
 }catch(e){$('#delete-error').textContent='삭제하지 못했습니다. '+e.message}
 finally{busy=false;$('#confirm-delete').disabled=false;$('#cancel-delete').disabled=false}
};
async function storageApi(route='',body){
 const response=await fetch('/api/storage'+route,{method:body===undefined?'GET':'POST',headers:{'X-Library-Client':'my-library',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(response.status===404)throw Error('저장 기능을 사용하려면 로컬 서버를 다시 실행해 주세요.');
 const data=await response.json();if(!response.ok)throw Error(data.error||'저장 공간에 연결할 수 없습니다.');return data;
}
function connectStorage(data){
 const loaded=data.content===null?[]:validate(JSON.parse(data.content));
 books=loaded;folder={native:true,path:data.directory,name:data.directory.split(/[\\/]/).pop()};revision=data.content;dirty=false;render();
}
$('#choose-folder').onclick=async()=>{
 if(busy)return;
 busy=true;$('#choose-folder').disabled=true;
 try{
  const selected=await storageApi('/select',{});if(selected.cancelled)return;
  if(selected.content!==null)validate(JSON.parse(selected.content));
  const request={token:selected.token,expected:selected.content};
  if(books.length&&selected.content===null){if(!confirm('비어 있는 폴더입니다. 현재 서재를 이 폴더에 복사할까요?'))return;request.content=serialize(books)}
  const connected=await storageApi('/connect',request);connectStorage(connected);toast('저장 폴더를 연결했습니다. 현재 저장 위치를 확인해 주세요.');
 }catch(e){toast('폴더를 열지 못했습니다. '+e.message)}finally{busy=false;$('#choose-folder').disabled=false}
};
async function restoreStorage(){
 $('#choose-folder').disabled=true;$('#add').disabled=true;$('#first-add').disabled=true;$('#import').disabled=true;
 try{if(deviceStorage){const raw=await deviceLibrary();const loaded=raw===null?[]:validate(JSON.parse(raw));books=loaded;revision=raw;deviceReady=true;folder={device:true,name:'이 기기'};render();$('#settings h2').textContent='이 기기에 보관하기';$('.settings-copy').textContent='책과 표지, 문장은 이 기기의 브라우저에 저장됩니다. PC와 자동으로 동기화되지 않습니다.';$('#settings > .help').textContent='브라우저 데이터를 지우면 기록이 삭제될 수 있습니다. 중요한 기록은 파일로 내보내 보관하세요. 접속 주소가 달라지면 별도의 저장 공간이 열립니다.';$('.backup p').textContent='기록 파일을 파일 앱에 보관하거나, PC에서 내보낸 파일을 가져오세요.';$('#export').textContent='파일로 내보내기';}else{const saved=await storageApi();if(saved.directory)connectStorage(saved)}}catch(e){toast('저장 위치를 복원하지 못했습니다. '+e.message)}
 finally{$('#choose-folder').disabled=false;$('#add').disabled=false;$('#first-add').disabled=false;$('#import').disabled=false}
}
window.addEventListener('DOMContentLoaded',restoreStorage);

$('#export').onclick=async()=>{try{const file=new File([serialize(books)],FILE,{type:'application/json'});if(deviceStorage&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'My Library 기록'});toast('파일 공유를 완료했습니다.')}else{download();toast('기록 파일 다운로드를 요청했습니다.')}dirty=false;render()}catch(e){if(e.name!=='AbortError')toast('내보내지 못했습니다. '+e.message)}};$('#import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const loaded=validate(JSON.parse(await file.text()));if(books.length&&!confirm('현재 화면의 서재를 가져온 기록으로 바꿀까요? 기존 폴더 파일은 변경되지 않습니다.'))return;if(deviceStorage){if(!deviceReady)throw Error('기기 저장 공간이 연결되지 않았습니다.');const text=serialize(loaded);await deviceLibrary(text,revision);revision=text;folder={device:true,name:'이 기기'};}else{folder=null;revision=null}books=loaded;dirty=false;render();toast(deviceStorage?'기록을 가져와 이 기기에 저장했습니다.':'기록을 불러왔습니다. 폴더를 선택하면 직접 저장할 수 있습니다.')}catch(e){toast('불러오지 못했습니다. '+e.message)}finally{e.target.value=''}};
document.querySelectorAll('[data-filter]').forEach(btn=>btn.onclick=()=>{filter=btn.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===btn));render()});
try{const savedSort=window.localStorage?.getItem('library-sort');if(['recent','title','rating','custom'].includes(savedSort))$('#sort').value=savedSort}catch{}
$('#search').oninput=render;$('#sort').onchange=()=>{try{window.localStorage?.setItem('library-sort',$('#sort').value)}catch{}render()};$('#add').onclick=$('#first-add').onclick=()=>openEditor();$('#close-editor').onclick=closeEditor;$('#editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});$('#storage').onclick=()=>$('#settings').showModal();$('#save-state').style.cursor='pointer';$('#save-state').onclick=()=>$('#settings').showModal();$('#close-settings').onclick=()=>$('#settings').close();window.addEventListener('beforeunload',e=>{if(dirty||($('#editor').open&&editorChanged())){e.preventDefault();e.returnValue=''}});render();

function outsideEditor(event){const editor=$('#editor'),r=editor.getBoundingClientRect();return event.target===editor&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)}
let editorBackdropPress=false;
$('#editor').addEventListener('pointerdown',event=>{editorBackdropPress=outsideEditor(event)});
$('#editor').addEventListener('pointercancel',()=>{editorBackdropPress=false});
$('#editor').addEventListener('click',event=>{const dismiss=editorBackdropPress&&outsideEditor(event);editorBackdropPress=false;if(dismiss)closeEditor()});

function updateShelfPlanks(){
 const shelf=$('#shelf');shelf.querySelectorAll('.shelf-plank,.shelf-plank-shadow').forEach(p=>p.remove());
 const base=shelf.getBoundingClientRect(),rows=[];
 shelf.querySelectorAll('.book').forEach(book=>{const r=book.getBoundingClientRect(),bottom=r.bottom-base.top;let row=rows.find(row=>Math.abs(row.bottom-bottom)<2);if(!row){row={bottom,left:r.left-base.left,right:r.right-base.left};rows.push(row)}else{row.left=Math.min(row.left,r.left-base.left);row.right=Math.max(row.right,r.right-base.left)}});
 for(const row of rows){const plank=document.createElement('div');plank.className='shelf-plank';plank.setAttribute('aria-hidden','true');Object.assign(plank.style,{top:(row.bottom-25)+'px',left:'0px',width:base.width+'px'});const shadow=document.createElement('div');shadow.className='shelf-plank-shadow';shadow.setAttribute('aria-hidden','true');Object.assign(shadow.style,{top:(row.bottom-18)+'px',left:(parseFloat(plank.style.left)+10)+'px',width:(parseFloat(plank.style.width)-15)+'px'});shelf.append(shadow,plank)}
}
if(typeof ResizeObserver!=='undefined'){
 let plankFrame;const schedule=()=>{cancelAnimationFrame(plankFrame);plankFrame=requestAnimationFrame(updateShelfPlanks)};
 new ResizeObserver(schedule).observe($('#shelf'));
 new MutationObserver(changes=>{if(changes.some(change=>[...change.addedNodes,...change.removedNodes].some(node=>node.nodeType===1&&node.classList.contains('book'))))schedule()}).observe($('#shelf'),{childList:true});
 $('#shelf').addEventListener('load',schedule,true);schedule();
}
