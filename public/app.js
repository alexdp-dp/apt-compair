let sources=[],typologies=[],selectedRooms=2,currentJob=null,pollTimer=null;
const $=id=>document.getElementById(id);
const normalize=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const nval=v=>v==null||v===''?null:Number(v);
const fmt=v=>v==null||v===''?'NA':new Intl.NumberFormat('ro-RO',{maximumFractionDigits:2}).format(Number(v));
const money=v=>v==null||v===''?'NA':new Intl.NumberFormat('ro-RO',{maximumFractionDigits:0}).format(Number(v))+' €';
const datefmt=v=>v?new Intl.DateTimeFormat('ro-RO',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'niciodată';
function initials(name){return name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
function sourceById(id){return sources.find(s=>s.id===id)}
function roomsOK(x){return selectedRooms===4?Number(x.rooms)>=4:Number(x.rooms)===selectedRooms}
function statusOK(x){if(x.status==='completed')return $('completed').checked;if(x.status==='construction')return $('underConstruction').checked;return $('unknownStatus').checked}
function facilityOK(x){const wanted=[...document.querySelectorAll('.facility:checked')].map(el=>normalize(el.value));if(!wanted.length)return true;const hay=normalize((x.facilities||[]).join(' '));return wanted.every(v=>hay.includes(v))}
function typologyPasses(x){
  const max=+$('maxPrice').value,min=+$('minArea').value,q=normalize($('search').value),city=$('city').value,zone=$('zone').value;
  const src=sourceById(x.source_id)||{};const hay=normalize([x.developer,x.project,x.type_name,x.page_title].join(' '));
  return roomsOK(x)&&statusOK(x)&&facilityOK(x)&&(!max||x.price_min==null||Number(x.price_min)<=max)&&(!min||x.useful_area==null||Number(x.useful_area)>=min)&&(!q||hay.includes(q))&&(!city||src.city===city)&&(!zone||src.zone===zone);
}
function sorted(items){const mode=$('sortBy').value;return [...items].sort((a,b)=>{
  if(mode==='priceAsc')return (nval(a.price_min)??Infinity)-(nval(b.price_min)??Infinity);
  if(mode==='sqmAsc'){const ap=a.price_min&&a.useful_area?Number(a.price_min)/Number(a.useful_area):Infinity,bp=b.price_min&&b.useful_area?Number(b.price_min)/Number(b.useful_area):Infinity;return ap-bp}
  if(mode==='areaDesc')return (nval(b.useful_area)??-1)-(nval(a.useful_area)??-1);
  return (b.confidence||0)-(a.confidence||0);
})}
function fillLocationFilters(){
  const cities=[...new Set(sources.map(s=>s.city).filter(Boolean))].sort();const current=$('city').value;$('city').innerHTML='<option value="">Toate orașele</option>'+cities.map(c=>`<option>${esc(c)}</option>`).join('');if(cities.includes(current))$('city').value=current;
  const city=$('city').value,zones=[...new Set(sources.filter(s=>!city||s.city===city).map(s=>s.zone).filter(Boolean))].sort();const zcur=$('zone').value;$('zone').innerHTML='<option value="">Toate zonele</option>'+zones.map(z=>`<option>${esc(z)}</option>`).join('');if(zones.includes(zcur))$('zone').value=zcur;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function sourceLocation(src,items){const address=items.find(x=>x.address)?.address;return [src.city,src.zone].filter(Boolean).join(' · ')||address||'Locație: NA'}
function typeMini(x){const ppm=x.price_min&&x.useful_area?Math.round(Number(x.price_min)/Number(x.useful_area)):null;return `<div class="type-mini"><b title="${esc(x.type_name)}">${esc(x.type_name||'NA')}</b><span class="sub">${x.rooms?x.rooms+' camere':'Camere: NA'}</span><span class="sub">${x.useful_area?fmt(x.useful_area)+' mp':'Suprafață: NA'}</span><span class="price">${money(x.price_min)}</span><span class="sqm">${ppm?fmt(ppm)+' €/mp':'€/mp: NA'}</span></div>`}
function renderProjects(){
  $('maxPriceValue').textContent=new Intl.NumberFormat('ro-RO').format(+$('maxPrice').value);$('minAreaValue').textContent=$('minArea').value+' mp';
  const q=normalize($('search').value);let cards=[];
  for(const src of sources.filter(s=>s.enabled)){
    const all=typologies.filter(x=>x.source_id===src.id);let matches=sorted(all.filter(typologyPasses));
    const searchProjectOK=!q||normalize(src.name).includes(q)||matches.length>0;
    if(!searchProjectOK)continue;
    if(all.length&&matches.length===0)continue;
    cards.push({src,all,matches});
  }
  const visibleTypes=cards.reduce((n,c)=>n+c.matches.length,0);$('meta').textContent=`${cards.length} proiecte · ${visibleTypes} tipologii care corespund filtrelor`;
  $('projects').innerHTML=cards.length?cards.map(({src,all,matches})=>{
    const hero=src.image_url?`<img src="${esc(src.image_url)}" alt="" onerror="this.remove()">`:`<div class="project-initials">${esc(initials(src.name))}</div>`;
    const preview=matches.slice(0,3);
    const body=preview.length?`<div class="types-preview">${preview.map(typeMini).join('')}</div>`:`<div class="project-empty"><div><strong>Nicio tipologie extrasă încă</strong><br><small>Scanează sursa pentru a popula proiectul.</small></div></div>`;
    return `<article class="project-card"><div class="project-hero">${hero}<div class="project-chip">${esc(src.name)}</div></div><div class="project-body"><div class="project-title">${esc(src.name)}</div><div class="project-location">${esc(sourceLocation(src,all))}</div>${body}<div class="project-footer"><button class="project-link" onclick="openTypes('${esc(src.id)}')">Vezi toate tipologiile →</button><span class="scan-date">Scanat: ${esc(datefmt(src.last_scanned_at))}</span></div></div></article>`
  }).join(''):`<div class="project-empty"><div><strong>Niciun proiect nu corespunde filtrelor.</strong><br><small>Resetează filtrele sau schimbă numărul de camere.</small></div></div>`;
}
function renderSources(){
  $('sources').innerHTML=sources.map(s=>`<div class="source"><div class="source-top"><div style="min-width:0"><b>${esc(s.name)}</b><small>${esc(s.url)}</small></div><div class="source-actions"><label title="Activă"><input class="toggle" type="checkbox" ${s.enabled?'checked':''} onchange="toggleSource('${esc(s.id)}',this.checked)"></label><button class="smallbtn" onclick="scanSource('${esc(s.id)}')">Scanează</button></div></div><small>Ultima scanare: ${esc(datefmt(s.last_scanned_at))}</small></div>`).join('');
}
async function loadData(){
  try{
    const [h,s,t]=await Promise.all([fetch('/api/health').then(r=>r.json()),fetch('/api/sources').then(r=>r.json()),fetch('/api/typologies').then(r=>r.json())]);
    $('dbBadge').classList.toggle('ok',!!h.databaseConfigured);$('dbBadge').classList.toggle('bad',!h.databaseConfigured);$('dbBadge').title=h.databaseConfigured?'PostgreSQL conectat':'DATABASE_URL lipsește';
    if(!Array.isArray(s))throw Error(s.error||'Nu pot încărca sursele');if(!Array.isArray(t))throw Error(t.error||'Nu pot încărca tipologiile');sources=s;typologies=t;fillLocationFilters();renderSources();renderProjects();
  }catch(e){showNotice(e.message)}
}
function showNotice(msg){$('notice').className='notice';$('notice').textContent=msg}
function hideNotice(){$('notice').className='';$('notice').textContent=''}
async function startJob(endpoint){
  hideNotice();const r=await fetch(endpoint,{method:'POST'}),j=await r.json();if(!r.ok)throw Error(j.error||'Scanarea nu a putut porni');currentJob=j.jobId;$('scanPanel').classList.remove('hidden');await pollJob();
}
async function scanSource(id){try{await startJob('/api/scan/'+encodeURIComponent(id))}catch(e){showNotice(e.message)}}
async function pollJob(){
  if(!currentJob)return;clearTimeout(pollTimer);
  try{const r=await fetch('/api/jobs/'+currentJob),j=await r.json();if(!r.ok)throw Error(j.error);renderJob(j);if(j.status==='running'){pollTimer=setTimeout(pollJob,1000)}else{await loadData();currentJob=null}}
  catch(e){showNotice('Status scanare: '+e.message);pollTimer=setTimeout(pollJob,2500)}
}
function renderJob(j){
  $('scanPanel').classList.remove('hidden');const total=Number(j.total_sources)||0,done=Number(j.completed_sources)||0,pct=total?Math.round(done/total*100):0;
  $('scanTitle').textContent=j.kind==='all'?'Actualizare toate sursele':'Actualizare sursă';$('scanSummary').textContent=`${done}/${total} surse · ${j.pages_scanned||0} pagini analizate · ${j.types_found||0} tipologii unice`;$('scanState').textContent=j.status.toUpperCase();$('scanProgress').style.width=pct+'%';
  $('scanGrid').innerHTML=(j.sources||[]).map(s=>`<div class="scan-source ${esc(s.status)}"><b>${esc(s.source_name)}</b><small>${esc(s.status)} · ${s.pages_scanned||0}${s.pages_total?' / '+s.pages_total:''} pagini · ${s.types_found||0} tipologii${s.error?' · '+s.error:''}</small></div>`).join('');
}
async function resumeLatestJob(){try{const j=await fetch('/api/latest-job').then(r=>r.json());if(j&&j.status==='running'){currentJob=j.id;renderJob(j);pollTimer=setTimeout(pollJob,500)}}catch{}}
function openTypes(sourceId){
  const src=sourceById(sourceId);const rows=sorted(typologies.filter(x=>x.source_id===sourceId));$('modalTitle').textContent=src?.name||'Proiect';$('modalRows').innerHTML=rows.length?rows.map(x=>{const ppm=x.price_min&&x.useful_area?Math.round(Number(x.price_min)/Number(x.useful_area)):null;return `<tr><td><b>${esc(x.type_name)}</b></td><td>${x.rooms??'NA'}</td><td>${x.useful_area?fmt(x.useful_area)+' mp':'NA'}</td><td>${money(x.price_min)}</td><td>${ppm?fmt(ppm)+' €':'NA'}</td><td>${x.vat==='included'?'Inclus':x.vat==='excluded'?'+ TVA':'NA'}</td><td>${esc(x.completion||'NA')}</td><td>${x.source_url?`<a href="${esc(x.source_url)}" target="_blank" rel="noopener">Vezi tipologia ↗</a>`:'NA'}</td></tr>`}).join(''):'<tr><td colspan="8" class="na">Nu există tipologii extrase.</td></tr>';$('typesModal').classList.add('open');$('typesModal').setAttribute('aria-hidden','false')
}
window.openTypes=openTypes;window.scanSource=scanSource;
window.toggleSource=async(id,enabled)=>{const r=await fetch('/api/sources/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})});if(!r.ok){const j=await r.json();showNotice(j.error||'Nu s-a putut actualiza sursa')}await loadData()};
$('scanAll').onclick=async()=>{try{await startJob('/api/scan-all')}catch(e){showNotice(e.message)}};
$('addSource').onclick=async()=>{const url=$('surl').value.trim(),name=$('sname').value.trim();if(!url)return showNotice('Introdu URL-ul sursei.');try{const r=await fetch('/api/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,url,city:$('scity').value.trim()||null,zone:$('szone').value.trim()||null})}),j=await r.json();if(!r.ok)throw Error(j.error);['sname','surl','scity','szone'].forEach(id=>$(id).value='');await loadData()}catch(e){showNotice(e.message)}};
$('manageSources').onclick=()=>{$('sourceDrawer').classList.add('open');$('sourceDrawer').setAttribute('aria-hidden','false')};$('closeDrawer').onclick=()=>{$('sourceDrawer').classList.remove('open');$('sourceDrawer').setAttribute('aria-hidden','true')};$('sourceDrawer').onclick=e=>{if(e.target===$('sourceDrawer'))$('closeDrawer').click()};
$('closeModal').onclick=()=>{$('typesModal').classList.remove('open');$('typesModal').setAttribute('aria-hidden','true')};$('typesModal').onclick=e=>{if(e.target===$('typesModal'))$('closeModal').click()};
document.querySelectorAll('#roomPicker button').forEach(b=>b.onclick=()=>{selectedRooms=+b.dataset.rooms;document.querySelectorAll('#roomPicker button').forEach(x=>x.classList.toggle('active',x===b));renderProjects()});
$('city').onchange=()=>{fillLocationFilters();renderProjects()};['zone','maxPrice','minArea','underConstruction','completed','unknownStatus','search','sortBy'].forEach(id=>$(id).addEventListener(['search','maxPrice','minArea'].includes(id)?'input':'change',renderProjects));document.querySelectorAll('.facility').forEach(x=>x.addEventListener('change',renderProjects));$('applyFilters').onclick=renderProjects;
$('reset').onclick=()=>{$('city').value='';fillLocationFilters();$('zone').value='';selectedRooms=2;document.querySelectorAll('#roomPicker button').forEach(x=>x.classList.toggle('active',x.dataset.rooms==='2'));$('maxPrice').value=250000;$('minArea').value=45;$('underConstruction').checked=true;$('completed').checked=true;$('unknownStatus').checked=true;$('search').value='';document.querySelectorAll('.facility').forEach(x=>x.checked=false);renderProjects()};
(async()=>{await loadData();await resumeLatestJob()})();
