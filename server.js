const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { Pool } = require('pg');

const BUILD = 12;
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const PUBLIC = path.join(__dirname, 'public');
const seedSources = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sources.json'), 'utf8'));

const norm = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const slug = s => norm(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function num(s) {
  if (s == null || s === '') return null;
  let x = String(s).replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if (!x) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g,'').replace(',','.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g,'');
  else x = x.replace(',','.');
  const n = Number.parseFloat(x);
  return Number.isFinite(n) ? n : null;
}
function resolveUrl(href, base) { try { return href ? new URL(href, base).href.split('#')[0] : null; } catch { return null; } }
function hostOf(u){ try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''} }
function sameHost(a,b){ return hostOf(a) === hostOf(b); }
function originOf(u){ try{return new URL(u).origin}catch{return null} }

function roomCount(typeName) {
  const t = norm(typeName).toLowerCase();
  const m = t.match(/\b([1-6])\s*(?:camere|camera)\b/i);
  if (m) return +m[1];
  if (/\b(?:studio|garsonier[ăa]?)\b/i.test(t)) return 1;
  return null;
}
function dwellingCategory(typeName) {
  const t = norm(typeName).toLowerCase();
  if (/\bgarsonier[ăa]?\b/.test(t)) return 'garsoniera';
  if (/\bstudio\b/.test(t)) return 'studio';
  if (/\bduplex\b/.test(t)) return 'duplex';
  if (/\bpenthouse\b/.test(t)) return 'penthouse';
  if (/\bvil[ăa]\b/.test(t)) return 'vila';
  if (/\bcas[ăa]\b|\bcase\b/.test(t)) return 'casa';
  if (/\btownhouse\b/.test(t)) return 'townhouse';
  return 'apartament';
}
function isGenericTypeName(t) {
  const s = slug(t);
  if (!s) return true;
  const generic = new Set([
    'apartament','apartamente','apartment','apartments','garsoniera','garsoniere','studio','studiouri','duplex','duplexuri','penthouse','penthouse-uri','vila','vile','casa','case','townhouse','townhouses',
    'apartament-1-camera','apartamente-1-camera','apartament-2-camere','apartamente-2-camere','apartament-3-camere','apartamente-3-camere','apartament-4-camere','apartamente-4-camere',
    '1-camera','2-camere','3-camere','4-camere','5-camere','tipologii','locuinte','unitati'
  ]);
  return generic.has(s);
}
function exactTypeName(s, sourceName='', fromMeta=false) {
  let t = norm(s).replace(/^[#•·\-–—\s]+/,'');
  if (fromMeta && sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    t = t.replace(new RegExp('\\s*[|–—-]\\s*'+escaped+'.*$','i'),'');
  }
  return norm(t);
}
function validTypeName(t) {
  t = norm(t);
  if (!t || t.length < 6 || t.length > 180 || isGenericTypeName(t)) return false;
  // Acceptăm titlul comercial complet, inclusiv cazurile în care site-ul îl scrie
  // ca „2 camere Torino”, fără cuvântul „Apartament”.
  const hasDwelling = /\b(?:apartament|studio|garsonier|duplex|penthouse|vil[ăa]|cas[ăa]|case|townhouse|[1-6]\s*(?:camere|camera))\b/i.test(t);
  if (!hasDwelling) return false;
  const words=t.split(/\s+/).filter(Boolean);
  const hasCode=/\b(?:tip\s+)?[A-ZĂÂÎȘȚ]?[0-9]{1,3}(?:[-.][A-Z0-9]+)*(?:\s+L\d+)?\b/i.test(t);
  const roomPlusName=/\b[1-6]\s*(?:camere|camera)\b/i.test(t) && words.length>=3;
  const namedCategory=/\b(?:studio|garsonier[ăa]?|duplex|penthouse|vil[ăa]|cas[ăa]|case|townhouse)\b/i.test(t) && words.length>=2;
  return hasCode || roomPlusName || namedCategory || words.length>=3;
}
function parseTypeCode(name) {
  const t = norm(name);
  const matches=[...t.matchAll(/\b([A-Z]\d+(?:[-.][A-Z0-9]+)*(?:\s+L\d+)?)\b/g)];
  return matches.length ? norm(matches[matches.length-1][1]) : null;
}
function parsePrice(text) {
  const t=norm(text);
  const bad=/\b(?:parcare|parking|loc(?:ul)?\s+de\s+parcare|garaj|garage|box[ăa]|storage|design|mobilare|mobilat|mobilier|furniture|comision|commission|avans|down\s*payment|rat[ăaei]|rate|lunar|monthly|chirie|rent|tax[ăa]|fee|notar|notarial)\b/i;
  const good=/\b(?:pre[țt](?:ul|uri)?|price|valoare|v[aâ]nzare|sale|de\s+la)\b/i;
  const found=[];
  for(const m of t.matchAll(/(?:de\s+la\s*)?([0-9]{2,3}(?:[.\s][0-9]{3})+(?:,[0-9]{1,2})?|[0-9]{4,7}(?:[.,][0-9]{1,2})?)\s*(?:€|eur(?:o)?\b)/ig)){
    const value=num(m[1]); if(value==null||value<5000||value>5000000)continue;
    const i=m.index||0, ctx=t.slice(Math.max(0,i-140),Math.min(t.length,i+m[0].length+140));
    let score=0;
    if(good.test(ctx)) score+=8;
    if(/\+\s*tva|tva\s*(?:inclus|included)/i.test(ctx)) score+=2;
    if(/^\s*de\s+la/i.test(m[0])) score+=1;
    if(bad.test(ctx)) score-=25;
    if(value<30000) score-=4;
    found.push({value,score,i});
  }
  if(!found.length)return null;
  found.sort((a,b)=>b.score-a.score || b.value-a.value || a.i-b.i);
  const best=found[0];
  if(found.length===1 && best.score>-20)return best.value;
  return best.score>=1 ? best.value : null;
}
function parseVat(text) {
  const t=norm(text);
  if (/tva\s+inclus|include\s+tva|cu\s+tva\s+inclus/i.test(t)) return 'included';
  if (/\+\s*tva|fără\s+tva|fara\s+tva|nu\s+include\s+tva/i.test(t)) return 'excluded';
  return null;
}
function parseAreas(text) {
  const t=norm(text); const get=r=>{const m=t.match(r);return m?num(m[1]):null};
  let useful=get(/Suprafa(?:ț|t)[aă]?\s+util[aă]?\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:m\s*2|m²|mp)/i);
  let total=get(/Suprafa(?:ț|t)[aă]?\s+total[aă]?\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:m\s*2|m²|mp)/i);
  const built=get(/Suprafa(?:ț|t)[aă]?\s+construit[aă]?\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:m\s*2|m²|mp)/i);
  const terrace=get(/(?:teras[aă]|balcon)\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:m\s*2|m²|mp)/i);
  if(!useful && !total){ const m=t.match(/\b([2-9]\d(?:[.,]\d{1,2})?|1\d\d(?:[.,]\d{1,2})?)\s*(?:m²|mp)\b/i); if(m) total=num(m[1]); }
  return { useful, total, built, terrace };
}
function parseAvailability(text) {
  const t=norm(text);
  // O tipologie poate conține simultan unități vândute și disponibile.
  // Dacă există cel puțin o unitate disponibilă, tipologia este disponibilă.
  if (/\bdisponibil(?:e|ă|a)?\b/i.test(t)) return 'available';
  if (/\bsold\s*out\b|\bvândut(?:\s+integral)?\b|\bvendut(?:\s+integral)?\b/i.test(t)) return 'sold_out';
  return null;
}
function parseAvailabilityDom($, scopeText='') {
  let available=0,sold=0,rows=0;
  const selectors='tr,[class*=availability] [class*=row],[class*=dispon] [class*=row],[class*=apartment] [class*=row],[class*=unit] [class*=row]';
  $(selectors).each((_,el)=>{
    const t=norm($(el).text());
    if(!t || t.length>800)return;
    const hasAvail=/\bdisponibil(?:e|ă|a)?\b/i.test(t);
    const hasSold=/\bsold\s*out\b|\bvândut(?:\s+integral)?\b|\bvendut(?:\s+integral)?\b/i.test(t);
    if(hasAvail||hasSold){rows++; if(hasAvail)available++; else if(hasSold)sold++;}
  });
  if(available>0)return 'available';
  if(rows>0 && sold===rows)return 'sold_out';
  return parseAvailability(scopeText);
}
function normalizePhaseStatus(s) {
  s=norm(s); if(/finalizat|livrat/i.test(s))return 'Finalizat'; if(/recepționat|receptionat/i.test(s))return 'Recepționată'; if(/în\s+construcție|in\s+constructie/i.test(s))return 'În construcție'; if(/în\s+curând|in\s+curand/i.test(s))return 'În curând'; return s||null;
}
function phaseFromUrl(url){ try{const m=new URL(url).pathname.match(/\/faza[-_/ ]?(\d+)\b/i);return m?`Faza ${m[1]}`:null}catch{return null} }
function parsePhaseMap(text){const out={};for(const m of norm(text).matchAll(/FAZA\s+(\d+)\s+(Finalizat(?:\s+și\s+livrat)?|Recepționat[ăa]?|În\s+construcție|In\s+constructie|În\s+curând|In\s+curand)/gi))out[`Faza ${m[1]}`]=normalizePhaseStatus(m[2]);return out}
function parseCategoryPrices(text){const t=norm(text),out={};const add=(k,r)=>{const m=t.match(r);if(m)out[k]={price:num(m[1]),vat:/\+\s*tva/i.test(m[0])?'excluded':parseVat(m[0])}};add('studio',/(?:tip\s+)?studio\s+de\s+la\s+([0-9.\s,]+)\s*€[^\d]{0,20}(?:\+\s*TVA)?/i);add('garsoniera',/(?:tip\s+)?garsonier[ăa]\s+de\s+la\s+([0-9.\s,]+)\s*€[^\d]{0,20}(?:\+\s*TVA)?/i);for(const r of [1,2,3,4,5])add(String(r),new RegExp(`${r}\\s*Camere?\\s+de\\s+la\\s+([0-9.\\s,]+)\\s*€[^\\d]{0,20}(?:\\+\\s*TVA)?`,'i'));return out}
function categoryPriceFor(name,rooms,map){const cat=dwellingCategory(name);if(cat==='studio'&&map.studio)return map.studio;if(cat==='garsoniera'&&map.garsoniera)return map.garsoniera;return map[String(rooms)]||null}

function parseJsonLd($){const out=[];$('script[type="application/ld+json"]').each((_,el)=>{try{const v=JSON.parse($(el).html());out.push(...(Array.isArray(v)?v:[v]))}catch{}});return out.flatMap(v=>v&&Array.isArray(v['@graph'])?v['@graph']:[v]).filter(Boolean)}
function canonicalCity(s){const m=norm(s).toLowerCase();const map=[['bucure','București'],['oradea','Oradea'],['cluj','Cluj-Napoca'],['brașov','Brașov'],['brasov','Brașov'],['timiș','Timișoara'],['timis','Timișoara'],['iași','Iași'],['iasi','Iași'],['constan','Constanța'],['ploi','Ploiești'],['voluntari','Voluntari'],['tunari','Tunari'],['dobroe','Dobroești']];const hit=map.find(([k])=>m.includes(k));return hit?hit[1]:null}
function cityFromCoords(lat,lng){if(lat==null||lng==null)return null;if(lat>44.30&&lat<44.60&&lng>25.85&&lng<26.30)return 'București';if(lat>47.00&&lat<47.15&&lng>21.80&&lng<22.05)return 'Oradea';return null}
function decodeMapQuery(u){try{const x=new URL(u);for(const k of ['q','query','destination']){const v=x.searchParams.get(k);if(v&&v.length>3)return decodeURIComponent(v.replace(/\+/g,' '))}}catch{}return null}
function findAddressData($, text, source) {
  let address=null,city=null,zone=null,lat=null,lng=null;
  for(const obj of parseJsonLd($)) {
    const a=obj.address||obj.location?.address;
    if(a&&typeof a==='object'){city ||= canonicalCity(a.addressLocality||a.addressRegion||'');const p=[a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode].map(norm).filter(Boolean);if(p.length)address ||= p.join(', ')}
    else if(typeof a==='string')address ||= norm(a);
    const geo=obj.geo||obj.location?.geo;if(geo){lat ||= num(geo.latitude);lng ||= num(geo.longitude)}
  }
  $('iframe[src*="google" i],a[href*="google.com/maps" i],a[href*="maps.google" i]').each((_,el)=>{const u=$(el).attr('src')||$(el).attr('href');const q=decodeMapQuery(resolveUrl(u,source.url));if(q&&!address&&!/^[-\d.,\s]+$/.test(q))address=norm(q)});
  const scripts=$('script').map((_,e)=>$(e).html()||'').get().join('\n');
  const coordPatterns=[/lat(?:itude)?\s*[:=]\s*["']?(-?\d{2}\.\d+)/i,/center\s*:\s*\{[^}]*lat\s*:\s*(-?\d{2}\.\d+)/i,/position\s*:\s*\{[^}]*lat\s*:\s*(-?\d{2}\.\d+)/i];
  const lngPatterns=[/lng|longitude/];
  for(const r of coordPatterns){const m=scripts.match(r);if(m){lat ||= num(m[1]);break}}
  if(lat!=null){const m=scripts.match(/(?:lng|longitude)\s*[:=]\s*["']?(-?\d{2}\.\d+)/i);if(m)lng ||= num(m[1])}
  const t=norm(text);
  if(!address){const m=t.match(/(?:Adresa proiectului|Adres[ăa]|Localizare|Locație|Locatie)\s*[:\-]?\s*(.{8,180}?)(?=Telefon|Email|Contact|Program|Solicit|Dezvoltat|$)/i);if(m)address=norm(m[1]).slice(0,180)}
  city ||= canonicalCity([address,t.slice(0,15000),source.name].filter(Boolean).join(' '));
  city ||= cityFromCoords(lat,lng);
  const hay=norm([address,t.slice(0,20000)].join(' '));const sec=hay.match(/\bSector(?:ul)?\s*([1-6])\b/i);if(sec)zone='Sector '+sec[1];
  if(!zone){const z=hay.match(/\b(?:zona|cartier(?:ul)?)\s*[:\-]?\s*([A-ZĂÂÎȘȚ][A-Za-zĂÂÎȘȚăâîșț\- ]{2,40})/);if(z)zone=norm(z[1]).split(/[,.;]/)[0]}
  return {address,city,zone,lat,lng};
}
function imageSrc($,el,base){if(!el||!el.length)return null;const raw=el.attr('data-src')||el.attr('data-lazy-src')||el.attr('src')||((el.attr('srcset')||'').split(',').pop()||'').trim().split(/\s+/)[0];return resolveUrl(raw,base)}
function isLikelyLogo(url,text=''){return /(?:logo|favicon|icon|brand|cropped)/i.test(String(url||'')+' '+text)}
function extractVisuals(html,url){const $=cheerio.load(html);let image=null,logo=null;for(const sel of ['[class*="hero"] img','[class*="banner"] img','[class*="slider"] img','[class*="cover"] img','main figure img','main img']){for(const el of $(sel).toArray()){const u=imageSrc($,$(el),url);if(u&&!isLikelyLogo(u,($(el).attr('class')||'')+' '+($(el).attr('alt')||''))){image=u;break}}if(image)break}const og=resolveUrl($('meta[property="og:image"]').attr('content')||$('meta[name="twitter:image"]').attr('content'),url);if(!image&&og&&!isLikelyLogo(og))image=og;const le=$('img[class*="logo"],header img[alt*="logo" i],header img').first();logo=imageSrc($,le,url);if(!logo&&og&&isLikelyLogo(og))logo=og;return{image,logo}}

async function fetchText(url, accept='text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const r=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':`Mozilla/5.0 (compatible; AptCompare/${BUILD}.0; +https://digitalpartners.ro)`,'accept-language':'ro-RO,ro;q=0.9,en;q=0.7','accept':accept}});if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);return {text:await r.text(),contentType:r.headers.get('content-type')||'',url:r.url||url}}finally{clearTimeout(timer)}
}
async function fetchHtml(url){const r=await fetchText(url);if(!/html/i.test(r.contentType)&&!/<(?:html|body|head)[\s>]/i.test(r.text.slice(0,1000)))throw new Error('Nu este HTML');return r.text}

function genericLeaf(pathname){const p=pathname.toLowerCase().replace(/\/+$/,'');const leaf=p.split('/').filter(Boolean).pop()||'';return /^(?:apartamente?|apartments?|garsoniere?|studiouri?|studio|vile|case|houses?|townhouses?|tipuri-de-case|tipologii|locuinte|unitati|proprietati|properties|faza-?\d+|phase-?\d+|proiecte?|projects?|home|acasa|contact|localizare|locatie|location)$/.test(leaf)||/^(?:apartamente?|apartments?)-(?:de-)?(?:vanzare-)?[1-6]-(?:camere|camera)$/.test(leaf)}
function isCandidateDetailUrl(url,root){try{const u=new URL(url);if(!sameHost(url,root))return false;if(genericLeaf(u.pathname)||u.pathname==='/'||/\.(?:jpg|jpeg|png|webp|svg|pdf|xml)$/i.test(u.pathname))return false;const p=u.pathname.toLowerCase();return /(?:apartament|apartment|studio|garson|duplex|penthouse|vila|villa|cas[ăa-]|case[-_/]|house|townhouse|unit|property|proprietate|tip[-_/])/i.test(p)}catch{return false}}
function isLocationUrl(url){try{return /\/(?:localizare|locatie|location|contact)(?:\/|$)/i.test(new URL(url).pathname)}catch{return false}}

async function discoverSitemaps(source){
  const origin=originOf(source.url);if(!origin)return [];
  const starts=new Set([origin+'/sitemap.xml',origin+'/sitemap_index.xml',origin+'/wp-sitemap.xml']);
  try{const robots=await fetchText(origin+'/robots.txt','text/plain,*/*');for(const m of robots.text.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)/gmi))starts.add(m[1].trim())}catch{}
  const seen=new Set(),urls=new Set(),queue=[...starts];
  while(queue.length&&seen.size<30){const sm=queue.shift();if(seen.has(sm))continue;seen.add(sm);try{const {text}=await fetchText(sm,'application/xml,text/xml,text/plain,*/*');for(const m of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)){const loc=norm(m[1].replace(/&amp;/g,'&'));if(!loc||!sameHost(loc,source.url))continue;if(/\.xml(?:\?|$)/i.test(loc)||/sitemap/i.test(loc)&&!isCandidateDetailUrl(loc,source.url)){if(!seen.has(loc)&&queue.length<100)queue.push(loc)}else urls.add(loc)}}catch{}
  }
  return [...urls];
}
function roomDescriptor(text){
  const t=norm(text);
  const m=t.match(/\b([1-6])\s*(camere|camera)(?:\s*\+\s*birou)?\b/i);
  if(m)return norm(m[0]);
  const c=t.match(/\b(garsonier[ăa]?|studio|duplex|penthouse|vil[ăa]|cas[ăa]|case|townhouse)\b/i);
  return c?norm(c[0]):null;
}
function commercialHintFromAnchor($,a,source){
  // Dacă ancora conține deja numele comercial complet, îl păstrăm literal.
  const direct=[];
  a.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"]').each((_,e)=>{const t=exactTypeName($(e).text(),source.name,false);if(t)direct.push(t)});
  const self=exactTypeName(a.text(),source.name,false);if(self)direct.push(self);
  for(const t of direct)if(validTypeName(t))return t;

  // IMPORTANT: multe template-uri țin categoria și numele în elemente/siblings diferite.
  // Urcăm controlat prin strămoși și alegem CEL MAI MIC container care conține
  // descriptorul de locuință + textul linkului. Astfel „2 camere + birou” + „Bonn”
  // devine exact „2 camere + birou Bonn”, fără să contaminăm cu cardurile vecine.
  let card=null, node=a;
  for(let i=0;i<7 && node && node.length;i++){
    const tx=norm(node.text());
    if(tx.length>=3 && tx.length<=2600 && roomDescriptor(tx)){card=node;break}
    node=node.parent();
  }
  if(!card||!card.length)card=a.closest('article,li,[class*="card"],[class*="apart"],[class*="property"],[class*="unit"],[class*="item"],[class*="box"]');
  if(!card.length)card=a.parent();
  const cardText=norm(card.text()).slice(0,2600),desc=roomDescriptor(cardText);
  if(!desc)return null;

  const bad=/^(?:home|despre noi|sold out|disponibil|află mai multe|afla mai multe|detalii|vezi|descoperă|descopera|solicită|solicita|economisești|economisesti|preț|pret|în complexul|in complexul)$/i;
  const anchorText=norm(a.text());
  let name=null;

  // Numele din ancora long-tail are prioritate dacă nu este chiar descriptorul.
  if(anchorText && anchorText.length<140 && !bad.test(anchorText) && slug(anchorText)!==slug(desc) && !/^([1-6])\s*(?:camere|camera)(?:\s*\+\s*birou)?$/i.test(anchorText)) name=anchorText;

  if(!name){
    card.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"]').each((_,e)=>{
      if(name)return;const t=norm($(e).text());if(!t||t.length>140||bad.test(t))return;
      if(slug(t)===slug(desc)||/^([1-6])\s*(?:camere|camera)(?:\s*\+\s*birou)?$/i.test(t)||/^(?:studio|garsonier[ăa]?|duplex|penthouse|vil[ăa]|cas[ăa]|case|townhouse)$/i.test(t))return;
      if(/^(?:în|in)\s+complexul/i.test(t)||/^(?:preț|pret)\s+de\s+la/i.test(t)||/^(?:disponibil|sold)/i.test(t))return;
      if(normalizeProjectish(t)===normalizeProjectish(source.name))return;
      name=t;
    });
  }
  if(!name)return null;
  // Nu dublăm descriptorul dacă numele îl conține deja.
  const built=new RegExp('(?:^|\\b)'+desc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\b|$)','i').test(name) ? norm(name) : norm(`${desc} ${name}`);
  return validTypeName(built)?built:null;
}
function normalizeProjectish(s){return slug(s).replace(/(?:residence|residential|development|group|oradea|city)$/g,'')}
function isDiscoveryUrl(url,label=''){
  try{
    const p=decodeURIComponent(new URL(url).pathname).toLowerCase(),t=norm(label).toLowerCase();
    if(genericLeaf(p))return /apart|vile|case|house|tipolog|locuinte|unitati|propriet|plan/i.test(p+' '+t);
    return /(?:apartamente|apartments|vile|case|houses|tipuri[- ]de[- ]case|tipologii|locuinte|unitati|proprietati|properties|plan[- ]interactiv)/i.test(p+' '+t);
  }catch{return false}
}
function discoverLinksFromHtml(html,base,source){
  const $=cheerio.load(html),detail=new Map(),locations=new Set(),discovery=new Set();
  const consider=(href,label='',anchor=null)=>{
    href=resolveUrl(href,base);if(!href||!sameHost(href,source.url))return;
    if(isLocationUrl(href)||/\b(?:localizare|locație|locatie|location)\b/i.test(label))locations.add(href);
    if(isCandidateDetailUrl(href,source.url)){
      const hint=anchor?commercialHintFromAnchor($,anchor,source):null;
      if(hint)detail.set(href,hint);else if(!detail.has(href))detail.set(href,null);
    } else if(isDiscoveryUrl(href,label)) discovery.add(href);
  };
  $('a[href]').each((_,el)=>{const a=$(el),label=norm(a.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"]').first().text())||norm(a.text());consider(a.attr('href'),label,a)});
  // Unele planuri interactive (ex. NARI) țin URL-urile locuințelor în data-* / JS,
  // nu în ancore HTML. Extragem și URL-urile long-tail din markup/scripturi.
  const raw=String(html).replace(/\\\//g,'/').replace(/&amp;/g,'&');
  for(const m of raw.matchAll(/(?:https?:\/\/[^"'<>\\s]+|\/(?:[^"'<>\\s]*?)(?:apartament|apartment|vila|villa|casa|case|house|townhouse|proprietate|property)[^"'<>\\s]*)/gi)){
    const href=m[0].replace(/[),;]+$/,'');consider(href,'',null);
  }
  return{detail,locations:[...locations],discovery:[...discovery]};
}

function listingRecordsFromHtml(html,base,source,ctx={}){
  const $=cheerio.load(html), out=[];
  $('a[href]').each((_,el)=>{
    const a=$(el), href=resolveUrl(a.attr('href'),base);
    if(!href||!sameHost(href,source.url)||!isCandidateDetailUrl(href,source.url))return;
    const hint=commercialHintFromAnchor($,a,source); if(!hint)return;
    let card=a.closest('article,li,[class*="card"],[class*="apart"],[class*="property"],[class*="unit"],[class*="item"],[class*="box"],[class*="room"]');
    if(!card.length){
      let n=a;
      for(let i=0;i<6&&n.length;i++,n=n.parent()){
        const tx=norm(n.text());
        if(tx.length>=20&&tx.length<=3500&&(roomDescriptor(tx)||/(?:€|eur\b|m²|mp\b)/i.test(tx))){card=n;break}
      }
    }
    if(!card.length)return;
    const clean=card.clone(); clean.find('script,style,noscript,svg,nav,footer').remove();
    const text=norm(clean.text()).slice(0,6000);
    const rooms=roomCount(hint),areas=parseAreas(text),price=parsePrice(text),cat=categoryPriceFor(hint,rooms,ctx.categoryPrices||{});
    let project=null;
    const projLink=card.find('a[href*="/proiect/"],a[href*="/project/"]').filter((_,e)=>e!==el).first();
    if(projLink.length){const pt=norm(projLink.text());if(pt&&pt.length<120&&!/^proiect/i.test(pt))project=pt}
    out.push({
      source_id:source.id,developer:source.name,project:project||source.name,
      type_name:hint,type_code:parseTypeCode(hint),rooms,
      price_min:price,price_max:null,vat:price?parseVat(text):null,
      category_price_from:price?null:(cat?.price||null),category_vat:price?null:(cat?.vat||null),
      useful_area:areas.useful,total_area:areas.total,built_area:areas.built,terrace_area:areas.terrace,
      availability:null,phase:phaseFromUrl(href)||ctx.phase||null,
      phase_status:(phaseFromUrl(href)&&ctx.phaseMap?ctx.phaseMap[phaseFromUrl(href)]:null)||ctx.phaseStatus||null,
      address:null,city:null,zone:null,facilities:[],source_url:href,
      project_image_url:null,project_logo_url:null,
      confidence:[hint,rooms,areas.useful||areas.total||areas.built,price||cat?.price].filter(v=>v!=null).length,
      _from_listing:true
    });
  });
  return out;
}

function extractTitle($,source,hint){
  const candidates=[];
  $('h1').each((_,e)=>candidates.push({text:norm($(e).text()),meta:false}));
  $('[class*="property-title"],[class*="apartment-title"],[class*="apartament-title"],[class*="unit-title"],[class*="entry-title"]').slice(0,5).each((_,e)=>candidates.push({text:norm($(e).text()),meta:false}));
  if(hint)candidates.push({text:hint,meta:false});
  candidates.push({text:norm($('meta[property="og:title"]').attr('content')),meta:true},{text:norm($('title').text()),meta:true});
  for(const c of candidates){const t=exactTypeName(c.text,source.name,c.meta);if(validTypeName(t))return t}return null;
}
function extractProjectName($,source){
  let project=null;
  const hostname=hostOf(source.url);

  if(/narivillage\.ro$/i.test(hostname)) return 'NARI Village';

  // HILS folosește proiectul în primul segment al URL-ului (ex. /nord/).
  // Paginile long-tail sunt /nord/apartament/..., deci nu lăsăm proiectul ca simplul hostname.
  if(/(?:^|\.)hils\.ro$/i.test(hostname)){
    try{const seg=new URL(source.url).pathname.split('/').filter(Boolean)[0];if(seg)return `HILS ${seg.charAt(0).toUpperCase()+seg.slice(1)}`}catch{}
  }

  // Alera este un portofoliu cu MAI MULTE proiecte sub aceeași sursă.
  // Nu căutăm niciodată în header/nav, fiindcă primul link din meniu este
  // Central Address Residence și contamina toate proprietățile.
  if(/aleraproperties\.ro$/i.test(hostname)){
    let main=$('main').first(); if(!main.length) main=$('body');
    const clean=main.clone(); clean.find('header,nav,footer,script,style,noscript').remove();
    const h1=clean.find('h1').first();
    if(h1.length){
      // pe paginile Alera, proiectul este linkul /proiect/ imediat înaintea H1
      const before=clean.find('a[href*="/proiect/"]').filter((_,e)=>{
        try{return clean.find('*').index(e) < clean.find('*').index(h1[0])}catch{return true}
      });
      const cand=norm(before.last().text());
      if(cand && cand.length>=3 && cand.length<120 && !/^proiect/i.test(cand)) project=cand;
    }
    if(!project){
      const firstProject=clean.find('a[href*="/proiect/"]').first();
      const cand=norm(firstProject.text());
      if(cand && cand.length>=3 && cand.length<120 && !/^proiect/i.test(cand)) project=cand;
    }
    if(!project){
      const txt=norm(clean.text()).slice(0,12000);
      const m=txt.match(/(?:situat(?:ă|a)?\s+(?:în|in)|în|in)\s+([A-ZĂÂÎȘȚ][A-Za-zĂÂÎȘȚăâîșț0-9 .&'’\-]{2,70}?(?:Residence|Rezidențial|Rezidential))\b/i);
      if(m)project=norm(m[1]);
    }
    return project||null; // niciodată source.name pentru Alera dacă nu știm proiectul
  }

  // Restul site-urilor: caută proiectul în conținut, nu în navigația globală.
  let main=$('main').first(); if(!main.length)main=$('body');
  const clean=main.clone();clean.find('header,nav,footer,script,style,noscript').remove();
  const body=norm(clean.text()).slice(0,30000);
  let m=body.match(/(?:În|In)\s+complexul\s*:\s*([A-ZĂÂÎȘȚ0-9][A-Za-zĂÂÎȘȚăâîșț0-9 .&'’\-]{2,80}?)(?=\s+(?:Preț|Pret|Suprafa|Sold|Disponibil|Solicit|Image|$))/i);
  if(m)project=norm(m[1]);
  if(!project){
    clean.find('a[href*="/proiect/"],a[href*="/project/"]').each((_,e)=>{const t=norm(clean.find(e).text());if(!project&&t.length>=3&&t.length<100&&!/^proiect/i.test(t))project=t});
  }
  if(!project){m=body.match(/(?:Proiect|Ansamblu)\s*[:\-]\s*([A-ZĂÂÎȘȚ][^|•]{3,90}?)(?=\s{2,}|Preț|Pret|Suprafa|$)/i);if(m)project=norm(m[1])}
  return project||source.name;
}
function detailRecord(html,url,source,ctx={},hint=null){
  const $=cheerio.load(html),title=extractTitle($,source,hint);if(!title)return null;
  let scope=$('h1').first().closest('[class*="apart"],[class*="property"],[class*="detail"],article,main');if(!scope.length)scope=$('main');if(!scope.length)scope=$('body');scope=scope.clone();scope.find('script,style,noscript,svg,nav,footer').remove();const text=norm(scope.text()).slice(0,50000);
  const rooms=roomCount(title),areas=parseAreas(text),price=parsePrice(text),cat=categoryPriceFor(title,rooms,ctx.categoryPrices||{}),loc=findAddressData($,norm($('body').text()).slice(0,100000),source),detailPhase=phaseFromUrl(url)||ctx.phase||null,detailPhaseStatus=(detailPhase&&ctx.phaseMap?ctx.phaseMap[detailPhase]:null)||ctx.phaseStatus||null;
  const project=extractProjectName($,source);
  // Pentru surse multi-proiect (Alera), un record fără proiect explicit este nesigur și este respins.
  if(/aleraproperties\.ro$/i.test(hostOf(source.url))&&!project)return null;
  const pv=extractVisuals(html,url);
  return {source_id:source.id,developer:source.name,project,type_name:title,type_code:parseTypeCode(title),rooms,price_min:price,price_max:null,vat:price?parseVat(text):null,category_price_from:price?null:(cat?.price||null),category_vat:price?null:(cat?.vat||null),useful_area:areas.useful,total_area:areas.total,built_area:areas.built,terrace_area:areas.terrace,availability:null,phase:detailPhase,phase_status:detailPhaseStatus,address:loc.address,city:loc.city,zone:loc.zone,facilities:[],source_url:url,project_image_url:pv.image,project_logo_url:pv.logo,confidence:[title,rooms,areas.useful||areas.total,price||cat?.price,project].filter(v=>v!=null).length};
}
function typeKey(x){return slug(x.project||'')+'::'+slug(x.type_name)}
function mergeTwo(a,b){const out={...a};for(const f of ['type_code','rooms','price_min','price_max','vat','category_price_from','category_vat','useful_area','total_area','built_area','terrace_area','availability','phase','phase_status','address','city','zone','project_image_url','project_logo_url'])if(out[f]==null&&b[f]!=null)out[f]=b[f];if((!out.project||normalizeProjectish(out.project)===normalizeProjectish(out.developer))&&b.project&&normalizeProjectish(b.project)!==normalizeProjectish(b.developer))out.project=b.project;if(b.source_url&&urlScore(b.source_url)>urlScore(out.source_url))out.source_url=b.source_url;out.confidence=Math.max(out.confidence||0,b.confidence||0);out.observed_count=(out.observed_count||1)+(b.observed_count||1);return out}
function urlScore(u){try{const p=new URL(u).pathname;return p.split('/').filter(Boolean).length*100+p.length}catch{return 0}}
function mergeTypologies(items){const m=new Map();for(const x of items){if(!validTypeName(x.type_name))continue;const k=typeKey(x);if(!m.has(k))m.set(k,{...x,observed_count:1});else m.set(k,mergeTwo(m.get(k),x))}return[...m.values()]}

async function db(q,p=[]){if(!pool)throw new Error('DATABASE_URL nu este configurat');return pool.query(q,p)}
async function migrate(){if(!pool)return;
  await db(`CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,city TEXT,zone TEXT,address TEXT,image_url TEXT,logo_url TEXT,last_scanned_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for(const c of ['address TEXT','image_url TEXT','logo_url TEXT','last_scanned_at TIMESTAMPTZ'])await db(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS ${c}`);
  await db(`CREATE TABLE IF NOT EXISTS typologies (id BIGSERIAL PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,type_key TEXT NOT NULL,developer TEXT,project TEXT,type_name TEXT NOT NULL,type_code TEXT,rooms INTEGER,price_min NUMERIC,price_max NUMERIC,vat TEXT,category_price_from NUMERIC,category_vat TEXT,useful_area NUMERIC,total_area NUMERIC,built_area NUMERIC,terrace_area NUMERIC,availability TEXT,phase TEXT,phase_status TEXT,status TEXT,completion TEXT,address TEXT,city TEXT,zone TEXT,facilities JSONB NOT NULL DEFAULT '[]'::jsonb,source_url TEXT,observed_count INTEGER NOT NULL DEFAULT 1,confidence INTEGER NOT NULL DEFAULT 0,first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),is_current BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE(source_id,type_key))`);
  for(const c of ['project_image_url TEXT','project_logo_url TEXT'])await db(`ALTER TABLE typologies ADD COLUMN IF NOT EXISTS ${c}`);
  for(const c of ['type_code TEXT','category_price_from NUMERIC','category_vat TEXT','availability TEXT','phase TEXT','phase_status TEXT','city TEXT','zone TEXT'])await db(`ALTER TABLE typologies ADD COLUMN IF NOT EXISTS ${c}`);
  await db(`CREATE TABLE IF NOT EXISTS price_history (id BIGSERIAL PRIMARY KEY,typology_id BIGINT NOT NULL REFERENCES typologies(id) ON DELETE CASCADE,price_min NUMERIC,price_max NUMERIC,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db(`CREATE TABLE IF NOT EXISTS scan_runs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,total_sources INTEGER NOT NULL DEFAULT 0,completed_sources INTEGER NOT NULL DEFAULT 0,pages_scanned INTEGER NOT NULL DEFAULT 0,types_found INTEGER NOT NULL DEFAULT 0,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,error TEXT)`);
  await db(`CREATE TABLE IF NOT EXISTS scan_source_runs (run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,source_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',pages_scanned INTEGER NOT NULL DEFAULT 0,pages_total INTEGER NOT NULL DEFAULT 0,types_found INTEGER NOT NULL DEFAULT 0,current_url TEXT,error TEXT,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,PRIMARY KEY(run_id,source_id))`);
  await db(`ALTER TABLE scan_source_runs ADD COLUMN IF NOT EXISTS pages_failed INTEGER NOT NULL DEFAULT 0`);
  // A deploy/restart can kill a background scan. Never leave the UI stuck forever on "running".
  await db(`UPDATE scan_source_runs SET status='error',error=COALESCE(error,'Scanare întreruptă de restart/deploy'),current_url=NULL,finished_at=NOW() WHERE status IN ('queued','scanning') AND run_id IN (SELECT id FROM scan_runs WHERE status='running' AND started_at < NOW() - INTERVAL '20 minutes')`);
  await db(`UPDATE scan_runs SET status='error',error=COALESCE(error,'Scanare întreruptă de restart/deploy'),finished_at=NOW() WHERE status='running' AND started_at < NOW() - INTERVAL '20 minutes'`);
  for(const s of seedSources)await db(`INSERT INTO sources(id,name,url,enabled,city,zone) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[s.id,s.name,s.url,s.enabled,s.city||null,s.zone||null]);
  await db(`UPDATE sources SET url='https://estoriacity-rezidential.ro/faza-3/',updated_at=NOW() WHERE id='estoria' AND url <> 'https://estoriacity-rezidential.ro/faza-3/'`);
}
async function sourceList(){return(await db(`SELECT * FROM sources ORDER BY created_at,id`)).rows}
async function typologyList(){return(await db(`SELECT t.*,s.city AS source_city,s.zone AS source_zone,s.address AS project_address,s.image_url,s.logo_url FROM typologies t JOIN sources s ON s.id=t.source_id WHERE t.is_current=TRUE ORDER BY COALESCE(t.project,s.name),t.rooms NULLS LAST,t.type_name`)).rows}
async function setSourceProgress(runId,sourceId,patch){const keys=Object.keys(patch);if(!keys.length)return;const vals=keys.map(k=>patch[k]);const sets=keys.map((k,i)=>`${k}=$${i+3}`).join(',');await db(`UPDATE scan_source_runs SET ${sets} WHERE run_id=$1 AND source_id=$2`,[runId,sourceId,...vals])}
async function bumpRun(runId,d=0){await db(`UPDATE scan_runs SET pages_scanned=pages_scanned+$2 WHERE id=$1`,[runId,d])}
async function updateSourceMeta(source,meta){const fields={},put=(k,v)=>{if(v)fields[k]=v};put('city',meta.city);put('zone',meta.zone);put('address',meta.address);put('image_url',meta.image);put('logo_url',meta.logo);const keys=Object.keys(fields);if(!keys.length)return;const vals=keys.map(k=>fields[k]);const sets=keys.map((k,i)=>`${k}=COALESCE($${i+2},${k})`).join(',');await db(`UPDATE sources SET ${sets},updated_at=NOW() WHERE id=$1`,[source.id,...vals])}

async function replaceTypologiesAtomic(source,found){
  if(!found.length)throw new Error('Scanarea nu a găsit nicio tipologie long-tail validă; datele existente au fost păstrate.');
  const client=await pool.connect();
  try{await client.query('BEGIN');const oldRows=(await client.query(`SELECT id,type_key,price_min,price_max FROM typologies WHERE source_id=$1`,[source.id])).rows;const oldMap=new Map(oldRows.map(r=>[r.type_key,r]));const seen=[];
    for(const x of found){const k=typeKey(x);seen.push(k);const r=await client.query(`INSERT INTO typologies(source_id,type_key,developer,project,type_name,type_code,rooms,price_min,price_max,vat,category_price_from,category_vat,useful_area,total_area,built_area,terrace_area,availability,phase,phase_status,address,city,zone,facilities,source_url,project_image_url,project_logo_url,observed_count,confidence,last_seen_at,is_current)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28,NOW(),TRUE)
      ON CONFLICT(source_id,type_key) DO UPDATE SET developer=EXCLUDED.developer,project=EXCLUDED.project,type_name=EXCLUDED.type_name,type_code=EXCLUDED.type_code,rooms=EXCLUDED.rooms,price_min=EXCLUDED.price_min,price_max=EXCLUDED.price_max,vat=EXCLUDED.vat,category_price_from=EXCLUDED.category_price_from,category_vat=EXCLUDED.category_vat,useful_area=EXCLUDED.useful_area,total_area=EXCLUDED.total_area,built_area=EXCLUDED.built_area,terrace_area=EXCLUDED.terrace_area,availability=EXCLUDED.availability,phase=EXCLUDED.phase,phase_status=EXCLUDED.phase_status,address=COALESCE(EXCLUDED.address,typologies.address),city=COALESCE(EXCLUDED.city,typologies.city),zone=COALESCE(EXCLUDED.zone,typologies.zone),source_url=EXCLUDED.source_url,project_image_url=COALESCE(EXCLUDED.project_image_url,typologies.project_image_url),project_logo_url=COALESCE(EXCLUDED.project_logo_url,typologies.project_logo_url),observed_count=EXCLUDED.observed_count,confidence=EXCLUDED.confidence,last_seen_at=NOW(),is_current=TRUE RETURNING id,price_min,price_max`,
      [source.id,k,x.developer,x.project,x.type_name,x.type_code,x.rooms,x.price_min,x.price_max,x.vat,x.category_price_from,x.category_vat,x.useful_area,x.total_area,x.built_area,x.terrace_area,x.availability,x.phase,x.phase_status,x.address,x.city,x.zone,JSON.stringify(x.facilities||[]),x.source_url,x.project_image_url,x.project_logo_url,x.observed_count||1,x.confidence||0]);
      const cur=r.rows[0],old=oldMap.get(k),changed=!old||String(old.price_min??'')!==String(cur.price_min??'')||String(old.price_max??'')!==String(cur.price_max??'');if(changed&&(cur.price_min!=null||cur.price_max!=null))await client.query(`INSERT INTO price_history(typology_id,price_min,price_max) VALUES($1,$2,$3)`,[cur.id,cur.price_min,cur.price_max]);
    }
    await client.query(`UPDATE typologies SET is_current=FALSE WHERE source_id=$1 AND NOT(type_key = ANY($2::text[]))`,[source.id,seen]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

async function scanOneSource(runId,source){
  await setSourceProgress(runId,source.id,{status:'scanning',started_at:new Date(),current_url:source.url,pages_failed:0});
  const collected=[],visited=new Set(),detailHints=new Map(),locationUrls=new Set();
  let pagesDone=0,pagesFailed=0;
  const started=Date.now(), SOURCE_BUDGET_MS=6*60*1000;
  const checkBudget=()=>{if(Date.now()-started>SOURCE_BUDGET_MS)throw new Error('Scanarea sursei a depășit 6 minute și a fost oprită controlat; datele vechi au fost păstrate.')};
  try{
    checkBudget();
    const rootHtml=await fetchHtml(source.url);visited.add(source.url);pagesDone=1;await bumpRun(runId,1);
    const root$=cheerio.load(rootHtml),rootText=norm(root$('body').text()).slice(0,180000),phaseMap=parsePhaseMap(rootText),phase=phaseFromUrl(source.url),phaseStatus=phase?(phaseMap[phase]||null):null,categoryPrices=parseCategoryPrices(rootText),ctx={pageUrl:source.url,phase,phaseStatus,phaseMap,categoryPrices};
    const visuals=extractVisuals(rootHtml,source.url),rootLoc=findAddressData(root$,rootText,source),rootLinks=discoverLinksFromHtml(rootHtml,source.url,source);for(const u of rootLinks.locations)locationUrls.add(u);for(const [u,h] of rootLinks.detail)detailHints.set(u,h);
    collected.push(...listingRecordsFromHtml(rootHtml,source.url,source,ctx));
    // Discovery pages sunt doar indexuri/listări. Le folosim să găsim long-tail-uri, nu le salvăm ca tipologii.
    for(const du of (rootLinks.discovery||[]).slice(0,12)){checkBudget();if(visited.has(du))continue;try{const dh=await fetchHtml(du);visited.add(du);pagesDone++;await bumpRun(runId,1);collected.push(...listingRecordsFromHtml(dh,du,source,ctx));const dl=discoverLinksFromHtml(dh,du,source);for(const u of dl.locations)locationUrls.add(u);for(const [u,h] of dl.detail)if(!detailHints.has(u))detailHints.set(u,h)}catch{pagesFailed++}}
    const sitemapUrls=await discoverSitemaps(source);for(const u of sitemapUrls){if(isLocationUrl(u))locationUrls.add(u);if(isCandidateDetailUrl(u,source.url)&&!detailHints.has(u))detailHints.set(u,null)}
    const origin=originOf(source.url);for(const p of ['/localizare/','/locatie/','/location/'])locationUrls.add(origin+p);
    let bestLoc=rootLoc;
    for(const lu of [...locationUrls].slice(0,8)){checkBudget();try{const html=await fetchHtml(lu),$=cheerio.load(html),tx=norm($('body').text()).slice(0,100000),loc=findAddressData($,tx,source);if(loc.address||loc.city||loc.zone){bestLoc={...bestLoc,...Object.fromEntries(Object.entries(loc).filter(([,v])=>v!=null))};break}}catch{}}
    await updateSourceMeta(source,{...bestLoc,...visuals});

    const processEntries=async(entries,discoverMore=false)=>{
      let next=0,finished=0;
      const workers=Array.from({length:Math.min(5,entries.length||1)},async()=>{
        while(true){
          checkBudget();
          const i=next++; if(i>=entries.length)return;
          const [url,hint]=entries[i];
          if(visited.has(url)){finished++;continue}
          visited.add(url);
          await setSourceProgress(runId,source.id,{current_url:url,pages_scanned:pagesDone,pages_total:Math.max(pagesDone+entries.length-finished,visited.size),types_found:mergeTypologies(collected).length,pages_failed:pagesFailed});
          try{
            const html=await fetchHtml(url),rec=detailRecord(html,url,source,ctx,hint);if(rec)collected.push(rec);
            if(discoverMore&&visited.size<70){const more=discoverLinksFromHtml(html,url,source);for(const [u,h] of more.detail)if(!detailHints.has(u)&&detailHints.size<240)detailHints.set(u,h)}
          }catch(e){pagesFailed++}
          pagesDone++;finished++;await bumpRun(runId,1);
          await setSourceProgress(runId,source.id,{pages_scanned:pagesDone,types_found:mergeTypologies(collected).length,pages_failed:pagesFailed});
        }
      });
      await Promise.all(workers);
    };

    const first=[...detailHints.entries()].filter(([u])=>u!==source.url).slice(0,180);
    await setSourceProgress(runId,source.id,{pages_scanned:pagesDone,pages_total:pagesDone+first.length,current_url:source.url,types_found:0,pages_failed:0});
    await processEntries(first,true);

    const extra=[...detailHints.entries()].filter(([u])=>u!==source.url&&!visited.has(u)).slice(0,60);
    if(extra.length){await setSourceProgress(runId,source.id,{pages_total:pagesDone+extra.length});await processEntries(extra,false)}

    const merged=mergeTypologies(collected);
    await replaceTypologiesAtomic(source,merged);
    await db(`UPDATE sources SET last_scanned_at=NOW(),updated_at=NOW() WHERE id=$1`,[source.id]);
    await setSourceProgress(runId,source.id,{status:'completed',pages_scanned:pagesDone,pages_total:pagesDone,types_found:merged.length,pages_failed:pagesFailed,current_url:null,finished_at:new Date(),error:pagesFailed?`${pagesFailed} pagini nu au răspuns; scanarea a continuat.`:null});
    await db(`UPDATE scan_runs SET completed_sources=completed_sources+1,types_found=types_found+$2 WHERE id=$1`,[runId,merged.length]);
  }catch(e){
    await setSourceProgress(runId,source.id,{status:'error',error:e.message,current_url:null,pages_scanned:pagesDone,pages_failed:pagesFailed,finished_at:new Date()});
    await db(`UPDATE scan_runs SET completed_sources=completed_sources+1 WHERE id=$1`,[runId]);
  }
}

async function executeRun(runId,ids){
  try{
    const ss=(await sourceList()).filter(s=>ids.includes(s.id));
    // Max. 4 surse simultan: un site lent sau blocat nu mai ține toate celelalte surse în coadă.
    let next=0;
    const workers=Array.from({length:Math.min(4,ss.length||1)},async()=>{while(true){const i=next++;if(i>=ss.length)return;await scanOneSource(runId,ss[i])}});
    await Promise.all(workers);
    const failed=Number((await db(`SELECT COUNT(*)::int AS n FROM scan_source_runs WHERE run_id=$1 AND status='error'`,[runId])).rows[0]?.n||0);
    await db(`UPDATE scan_runs SET status=$2,finished_at=NOW(),error=$3 WHERE id=$1`,[runId,failed?'completed_with_errors':'completed',failed?`${failed} surse au terminat cu eroare`:null]);
  }catch(e){await db(`UPDATE scan_runs SET status='error',error=$2,finished_at=NOW() WHERE id=$1`,[runId,e.message])}
}
async function createRun(ids,kind){const unique=[...new Set(ids)],sources=(await sourceList()).filter(s=>unique.includes(s.id));if(!sources.length)throw new Error('Nu ai selectat nicio sursă');const id=crypto.randomUUID();await db(`INSERT INTO scan_runs(id,kind,status,total_sources) VALUES($1,$2,'running',$3)`,[id,kind,sources.length]);for(const s of sources)await db(`INSERT INTO scan_source_runs(run_id,source_id,source_name,status) VALUES($1,$2,$3,'queued')`,[id,s.id,s.name]);setImmediate(()=>executeRun(id,sources.map(s=>s.id)));return id}
async function getRun(id){const run=(await db(`SELECT * FROM scan_runs WHERE id=$1`,[id])).rows[0];if(!run)return null;run.sources=(await db(`SELECT * FROM scan_source_runs WHERE run_id=$1 ORDER BY started_at NULLS LAST,source_name`,[id])).rows;return run}
function json(res,status,obj){const b=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'});res.end(b)}
async function readBody(req){return await new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e6){reject(new Error('Body prea mare'));req.destroy()}});req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}});req.on('error',reject)})}
function serve(res,file){try{const b=fs.readFileSync(file),ext=path.extname(file),ct={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream';res.writeHead(200,{'content-type':ct});res.end(b)}catch{res.writeHead(404);res.end('Not found')}}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');try{
  if(u.pathname==='/api/health')return json(res,200,{ok:true,databaseConfigured:!!pool,build:BUILD});
  if(!pool&&u.pathname.startsWith('/api/'))return json(res,503,{error:'Database not configured. Setează DATABASE_URL în Render.'});
  if(req.method==='GET'&&u.pathname==='/api/sources')return json(res,200,await sourceList());
  if(req.method==='GET'&&u.pathname==='/api/typologies')return json(res,200,await typologyList());
  if(req.method==='GET'&&u.pathname==='/api/admin/projects')return json(res,200,(await db(`SELECT t.source_id,s.name AS source_name,COALESCE(t.project,s.name) AS project,COUNT(*)::int AS count FROM typologies t JOIN sources s ON s.id=t.source_id WHERE t.is_current=TRUE GROUP BY t.source_id,s.name,COALESCE(t.project,s.name) ORDER BY s.name,project`)).rows);
  if(req.method==='POST'&&u.pathname==='/api/admin/clear-project'){const b=await readBody(req);if(!b.sourceId||!b.project)return json(res,400,{error:'sourceId și project sunt obligatorii'});const r=await db(`DELETE FROM typologies WHERE source_id=$1 AND COALESCE(project,'')=$2`,[b.sourceId,b.project]);return json(res,200,{ok:true,deleted:r.rowCount})}
  if(req.method==='POST'&&u.pathname==='/api/admin/clear-source'){const b=await readBody(req);if(!b.sourceId)return json(res,400,{error:'sourceId obligatoriu'});const r=await db(`DELETE FROM typologies WHERE source_id=$1`,[b.sourceId]);await db(`UPDATE sources SET last_scanned_at=NULL WHERE id=$1`,[b.sourceId]);return json(res,200,{ok:true,deleted:r.rowCount})}
  if(req.method==='POST'&&u.pathname==='/api/admin/clear-all'){await db(`TRUNCATE TABLE price_history, typologies, scan_source_runs, scan_runs RESTART IDENTITY CASCADE`);await db(`UPDATE sources SET last_scanned_at=NULL`);return json(res,200,{ok:true})}
  if(req.method==='POST'&&u.pathname==='/api/sources'){const b=await readBody(req);if(!b.url)return json(res,400,{error:'URL obligatoriu'});let parsed;try{parsed=new URL(b.url)}catch{return json(res,400,{error:'URL invalid'})}const name=norm(b.name)||parsed.hostname.replace(/^www\./,'');let id=slug(name)||'source';if((await db(`SELECT 1 FROM sources WHERE id=$1`,[id])).rowCount)id+='-'+Date.now().toString(36);await db(`INSERT INTO sources(id,name,url,enabled,city,zone) VALUES($1,$2,$3,TRUE,$4,$5)`,[id,name,parsed.href,b.city||null,b.zone||null]);return json(res,201,(await db(`SELECT * FROM sources WHERE id=$1`,[id])).rows[0])}
  if(req.method==='PATCH'&&u.pathname.startsWith('/api/sources/')){const id=decodeURIComponent(u.pathname.split('/').pop()),b=await readBody(req);if(typeof b.enabled==='boolean')await db(`UPDATE sources SET enabled=$2,updated_at=NOW() WHERE id=$1`,[id,b.enabled]);return json(res,200,(await db(`SELECT * FROM sources WHERE id=$1`,[id])).rows[0])}
  if(req.method==='POST'&&u.pathname==='/api/scan-all'){const ids=(await sourceList()).filter(s=>s.enabled).map(s=>s.id);return json(res,202,{jobId:await createRun(ids,'all')})}
  if(req.method==='POST'&&u.pathname==='/api/scan-selected'){const b=await readBody(req),ids=Array.isArray(b.sourceIds)?b.sourceIds:[];return json(res,202,{jobId:await createRun(ids,'selected')})}
  let m=u.pathname.match(/^\/api\/scan\/([^/]+)$/);if(req.method==='POST'&&m){const s=(await db(`SELECT * FROM sources WHERE id=$1`,[decodeURIComponent(m[1])])).rows[0];if(!s)return json(res,404,{error:'Sursa nu există'});return json(res,202,{jobId:await createRun([s.id],'single')})}
  m=u.pathname.match(/^\/api\/jobs\/([^/]+)$/);if(req.method==='GET'&&m){const j=await getRun(m[1]);return j?json(res,200,j):json(res,404,{error:'Job inexistent'})}
  if(req.method==='GET'&&u.pathname==='/api/latest-job'){const j=(await db(`SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT 1`)).rows[0];return j?json(res,200,await getRun(j.id)):json(res,200,null)}
  if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/index.html'))return serve(res,path.join(PUBLIC,'index.html'));
  if(req.method==='GET'&&/^\/(?:app\.js|styles\.css)$/.test(u.pathname))return serve(res,path.join(PUBLIC,path.basename(u.pathname)));
  res.writeHead(404);res.end('Not found');
}catch(e){console.error(e);json(res,500,{error:e.message||'Eroare internă'})}});

if(require.main===module){migrate().then(()=>server.listen(PORT,()=>console.log(`AptCompare Build ${BUILD} on ${PORT}`))).catch(e=>{console.error(e);process.exit(1)})}
module.exports={validTypeName,exactTypeName,parseTypeCode,isCandidateDetailUrl,findAddressData,detailRecord,discoverLinksFromHtml,mergeTypologies,typeKey};
