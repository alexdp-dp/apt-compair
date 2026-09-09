const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const PUBLIC = path.join(__dirname, 'public');
const seedSources = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sources.json'), 'utf8'));

const norm = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const slug = s => norm(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const now = () => new Date().toISOString();
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
function roomCount(text) {
  const t = norm(text).toLowerCase();
  let m = t.match(/(?:^|\D)([1-6])\s*(?:camere|camera|rooms?|dormitoare?)(?:\D|$)/i);
  if (m) return +m[1];
  if (/\b(?:studio|garsonier[ăa]?)\b/i.test(t)) return 1;
  return null;
}
function cleanType(type) {
  let t = norm(type)
    .replace(/^apartament(?:ul)?\s*/i,'')
    .replace(/^apartment\s*/i,'')
    .replace(/^tip(?:ul)?\s*/i,'')
    .replace(/\s*[-–|]\s*(?:apartament|apartment).*$/i,'')
    .trim();
  if (!t || /^(?:apartament|apartamente|tament|tamente|apartment|apartments)$/i.test(t)) return null;
  return t.slice(0, 120);
}
function extractType(text, pageTitle='') {
  const all = norm(text + ' ' + pageTitle);
  const patterns = [
    /\b(?:tip|type)\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-]{0,15})\b/i,
    /\b([A-Z]\d+(?:\.\d+){0,3}[A-Z]?)\b/,
    /\b(T\d+[A-Z]?)\b/i,
    /\b(C\d+(?:[-.]?[A-Z0-9]+)*)\b/i
  ];
  for (const p of patterns) {
    const m = all.match(p); if (m) { const x = cleanType(m[1]); if (x) return x; }
  }
  const heading = norm(pageTitle || text).replace(/\s*[|–-].*$/,'');
  const h = heading.match(/(?:apartament|apartment|studio|garsonier[ăa]?|duplex|vil[ăa])\s+(.{1,55})/i);
  if (h) {
    const candidate = cleanType(h[1].replace(/\b\d+\s*camere?.*$/i,'').trim());
    if (candidate && candidate.length <= 40) return candidate;
  }
  return null;
}
function parseCompletion(text) {
  const t = norm(text);
  const m = t.match(/(?:finalizare|termen(?:\s+de)?\s+finalizare|livrare|predare|completion)[^.;\n]{0,70}/i);
  return m ? norm(m[0]) : null;
}
function parseStatus(text) {
  const t = norm(text).toLowerCase();
  if (/\b(?:finalizat|finalizată|gata de mutare|ready to move)\b/i.test(t)) return 'completed';
  if (/\b(?:în construcție|in constructie|în dezvoltare|in development|under construction)\b/i.test(t)) return 'construction';
  return null;
}
function parseVat(text) {
  const t = norm(text);
  if (/tva\s+inclus|include\s+tva/i.test(t)) return 'included';
  if (/\+\s*tva|fără\s+tva|fara\s+tva|nu\s+include\s+tva/i.test(t)) return 'excluded';
  return null;
}
function parsePrice(text) {
  const t = norm(text);
  const matches = [...t.matchAll(/(?:de\s+la\s*)?([0-9]{2,3}(?:[.\s][0-9]{3})+(?:,[0-9]{1,2})?|[0-9]{4,6}(?:[.,][0-9]{1,2})?)\s*(?:€|eur(?:o)?\b)/ig)]
    .map(m => num(m[1])).filter(n => n && n >= 15000 && n <= 5000000);
  return matches.length ? Math.min(...matches) : null;
}
function parseAreas(text) {
  const t = norm(text);
  function pick(regex) { const m=t.match(regex); return m ? num(m[1]) : null; }
  let useful = pick(/suprafa(?:ț|t)[ăa]\s+util[ăa]\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:mp|m²)/i);
  let total = pick(/suprafa(?:ț|t)[ăa]\s+(?:total[ăa]|util[ăa]\s+total[ăa])\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:mp|m²)/i);
  let built = pick(/suprafa(?:ț|t)[ăa]\s+construit[ăa]\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:mp|m²)/i);
  let terrace = pick(/(?:teras[ăa]|balcon)\s*[:\-]?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*(?:mp|m²)/i);
  if (!useful) {
    const generic = [...t.matchAll(/([0-9]{2,3}(?:[.,][0-9]{1,2})?)\s*(?:mp|m²)/ig)].map(m=>num(m[1])).filter(n=>n>=20&&n<=500);
    if (generic.length === 1) useful = generic[0];
  }
  return { useful, total, built, terrace };
}
function parseAddress(text) {
  const t = norm(text);
  const m = t.match(/(?:adres[ăa]|address)\s*[:\-]\s*([^|;]{5,120})/i);
  return m ? norm(m[1]) : null;
}
function isDetailUrl(url, root) {
  try {
    const u = new URL(url), r = new URL(root);
    if (u.hostname.replace(/^www\./,'') !== r.hostname.replace(/^www\./,'')) return false;
    const p = u.pathname.toLowerCase();
    if (p === r.pathname.toLowerCase() || p === '/' || /\/apartamente?\/?$|\/apartments?\/?$/i.test(p)) return false;
    return /(apartament|apartment|unit|tip-|type-|garson|studio|duplex|vila|villa)/i.test(p);
  } catch { return false; }
}
function resolveUrl(href, base) { try { return new URL(href, base).href.split('#')[0]; } catch { return null; } }
function sameHost(a,b) { try { return new URL(a).hostname.replace(/^www\./,'') === new URL(b).hostname.replace(/^www\./,''); } catch { return false; } }
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, { redirect:'follow', signal:controller.signal, headers:{'user-agent':'Mozilla/5.0 (compatible; AptCompare/3.0; +https://digitalpartners.ro)','accept-language':'ro-RO,ro;q=0.9,en;q=0.7'} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/html')) throw new Error('Nu este HTML');
    return await r.text();
  } finally { clearTimeout(timer); }
}
function pageInfo(html, url, source) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const pageTitle = norm($('h1').first().text() || $('title').text());
  const text = norm($('body').text()).slice(0, 180000);
  const type = extractType(text, pageTitle);
  const rooms = roomCount(pageTitle + ' ' + text);
  const price = parsePrice(text);
  const areas = parseAreas(text);
  const confidence = [type, rooms, price, areas.useful].filter(v=>v!=null).length;
  if (!type || confidence < 2) return null;
  return {
    source_id: source.id,
    developer: source.name,
    project: source.name,
    type_name: type,
    rooms,
    price_min: price,
    price_max: null,
    vat: parseVat(text),
    useful_area: areas.useful,
    total_area: areas.total,
    built_area: areas.built,
    terrace_area: areas.terrace,
    status: parseStatus(text),
    completion: parseCompletion(text),
    address: parseAddress(text),
    facilities: [],
    source_url: url,
    page_title: pageTitle || null,
    confidence
  };
}
function listCandidates(html, base, source) {
  const $ = cheerio.load(html);
  const detailLinks = new Set();
  $('a[href]').each((_,el)=>{
    const href = resolveUrl($(el).attr('href'), base); if (!href || !sameHost(href, base)) return;
    const tx = norm($(el).text());
    if (isDetailUrl(href, source.url) || /(?:tip|apartament|apartment|studio|garsonier|duplex|vil[ăa])/i.test(tx)) detailLinks.add(href);
  });
  const inline = [];
  $('[class*="apart"],[class*="property"],[class*="unit"],[class*="tipolog"],[class*="card"]').each((_,el)=>{
    const tx = norm($(el).text());
    if (tx.length < 20 || tx.length > 3000) return;
    const type = extractType(tx, norm($(el).find('h1,h2,h3,h4').first().text()));
    const rooms = roomCount(tx), price = parsePrice(tx), areas = parseAreas(tx);
    if (!type || [rooms,price,areas.useful].filter(v=>v!=null).length < 1) return;
    const href = resolveUrl($(el).is('a') ? $(el).attr('href') : $(el).find('a[href]').first().attr('href'), base) || base;
    inline.push({
      source_id: source.id, developer: source.name, project: source.name, type_name:type, rooms,
      price_min:price, price_max:null, vat:parseVat(tx), useful_area:areas.useful,total_area:areas.total,built_area:areas.built,terrace_area:areas.terrace,
      status:parseStatus(tx),completion:parseCompletion(tx),address:parseAddress(tx),facilities:[],source_url:href,page_title:null,confidence:[type,rooms,price,areas.useful].filter(v=>v!=null).length
    });
  });
  return { links:[...detailLinks].slice(0,160), inline };
}
function keyFor(x) {
  return [x.source_id, slug(x.type_name), x.rooms || ''].join('|');
}
function mergeTypologies(items) {
  const map = new Map();
  for (const x of items) {
    if (!x.type_name) continue;
    const k = keyFor(x);
    if (!map.has(k)) map.set(k, {...x, observed_count:1});
    else {
      const a = map.get(k); a.observed_count++;
      const prices = [a.price_min,x.price_min].filter(v=>v!=null); if (prices.length) a.price_min=Math.min(...prices);
      const maxes = [a.price_max,a.price_min,x.price_max,x.price_min].filter(v=>v!=null); if (maxes.length>1) a.price_max=Math.max(...maxes);
      for (const f of ['rooms','useful_area','total_area','built_area','terrace_area','vat','status','completion','address']) if (a[f]==null && x[f]!=null) a[f]=x[f];
      if (x.source_url) { const score=u=>{try{return new URL(u).pathname.split('/').filter(Boolean).length*100 + new URL(u).pathname.length}catch{return 0}}; if (!a.source_url || score(x.source_url)>score(a.source_url)) a.source_url=x.source_url; }
      a.confidence=Math.max(a.confidence||0,x.confidence||0);
    }
  }
  return [...map.values()];
}

async function db(q, params=[]) { if (!pool) throw new Error('DATABASE_URL nu este configurat'); return pool.query(q, params); }
async function migrate() {
  if (!pool) return;
  await db(`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
    city TEXT, zone TEXT, image_url TEXT, last_scanned_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await db(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ`);
  await db(`CREATE TABLE IF NOT EXISTS typologies (
    id BIGSERIAL PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    type_key TEXT NOT NULL, developer TEXT, project TEXT, type_name TEXT NOT NULL, rooms INTEGER,
    price_min NUMERIC, price_max NUMERIC, vat TEXT, useful_area NUMERIC, total_area NUMERIC, built_area NUMERIC, terrace_area NUMERIC,
    status TEXT, completion TEXT, address TEXT, facilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_url TEXT, observed_count INTEGER NOT NULL DEFAULT 1, confidence INTEGER NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), is_current BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(source_id, type_key)
  )`);
  await db(`CREATE TABLE IF NOT EXISTS price_history (
    id BIGSERIAL PRIMARY KEY, typology_id BIGINT NOT NULL REFERENCES typologies(id) ON DELETE CASCADE,
    price_min NUMERIC, price_max NUMERIC, observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS scan_runs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, total_sources INTEGER NOT NULL DEFAULT 0,
    completed_sources INTEGER NOT NULL DEFAULT 0, pages_scanned INTEGER NOT NULL DEFAULT 0, types_found INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ, error TEXT
  )`);
  await db(`CREATE TABLE IF NOT EXISTS scan_source_runs (
    run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', pages_scanned INTEGER NOT NULL DEFAULT 0,
    pages_total INTEGER NOT NULL DEFAULT 0, types_found INTEGER NOT NULL DEFAULT 0, current_url TEXT, error TEXT,
    started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, PRIMARY KEY(run_id, source_id)
  )`);
  for (const s of seedSources) await db(`INSERT INTO sources(id,name,url,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,[s.id,s.name,s.url,s.enabled]);
}
async function sourceList() { return (await db(`SELECT * FROM sources ORDER BY created_at,id`)).rows; }
async function typologyList() {
  return (await db(`SELECT t.*, s.city, s.zone, s.image_url FROM typologies t JOIN sources s ON s.id=t.source_id WHERE t.is_current=TRUE ORDER BY s.name,t.rooms NULLS LAST,t.type_name`)).rows;
}
async function setSourceProgress(runId, sourceId, patch) {
  const keys=Object.keys(patch); if (!keys.length) return;
  const vals=keys.map(k=>patch[k]); const sets=keys.map((k,i)=>`${k}=$${i+3}`).join(',');
  await db(`UPDATE scan_source_runs SET ${sets} WHERE run_id=$1 AND source_id=$2`,[runId,sourceId,...vals]);
}
async function bumpRun(runId, pagesDelta=0, typesFound=null) {
  if (typesFound==null) await db(`UPDATE scan_runs SET pages_scanned=pages_scanned+$2 WHERE id=$1`,[runId,pagesDelta]);
  else await db(`UPDATE scan_runs SET pages_scanned=pages_scanned+$2, types_found=types_found+$3 WHERE id=$1`,[runId,pagesDelta,typesFound]);
}
async function upsertTypologies(source, found) {
  const seenKeys=[];
  for (const x of found) {
    const typeKey = [slug(x.type_name),x.rooms||''].join('|'); seenKeys.push(typeKey);
    const old = (await db(`SELECT id,price_min,price_max FROM typologies WHERE source_id=$1 AND type_key=$2`,[source.id,typeKey])).rows[0];
    const r = await db(`INSERT INTO typologies(source_id,type_key,developer,project,type_name,rooms,price_min,price_max,vat,useful_area,total_area,built_area,terrace_area,status,completion,address,facilities,source_url,observed_count,confidence,last_seen_at,is_current)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,NOW(),TRUE)
      ON CONFLICT(source_id,type_key) DO UPDATE SET developer=EXCLUDED.developer,project=EXCLUDED.project,type_name=EXCLUDED.type_name,rooms=COALESCE(EXCLUDED.rooms,typologies.rooms),price_min=COALESCE(EXCLUDED.price_min,typologies.price_min),price_max=COALESCE(EXCLUDED.price_max,typologies.price_max),vat=COALESCE(EXCLUDED.vat,typologies.vat),useful_area=COALESCE(EXCLUDED.useful_area,typologies.useful_area),total_area=COALESCE(EXCLUDED.total_area,typologies.total_area),built_area=COALESCE(EXCLUDED.built_area,typologies.built_area),terrace_area=COALESCE(EXCLUDED.terrace_area,typologies.terrace_area),status=COALESCE(EXCLUDED.status,typologies.status),completion=COALESCE(EXCLUDED.completion,typologies.completion),address=COALESCE(EXCLUDED.address,typologies.address),source_url=COALESCE(EXCLUDED.source_url,typologies.source_url),observed_count=EXCLUDED.observed_count,confidence=GREATEST(typologies.confidence,EXCLUDED.confidence),last_seen_at=NOW(),is_current=TRUE RETURNING id,price_min,price_max`,
      [source.id,typeKey,x.developer,x.project,x.type_name,x.rooms,x.price_min,x.price_max,x.vat,x.useful_area,x.total_area,x.built_area,x.terrace_area,x.status,x.completion,x.address,JSON.stringify(x.facilities||[]),x.source_url,x.observed_count||1,x.confidence||0]);
    const current=r.rows[0];
    const changed=!old || String(old.price_min??'')!==String(current.price_min??'') || String(old.price_max??'')!==String(current.price_max??'');
    if (changed && (current.price_min!=null || current.price_max!=null)) await db(`INSERT INTO price_history(typology_id,price_min,price_max) VALUES($1,$2,$3)`,[current.id,current.price_min,current.price_max]);
  }
  if (seenKeys.length) await db(`UPDATE typologies SET is_current=FALSE WHERE source_id=$1 AND NOT(type_key = ANY($2::text[]))`,[source.id,seenKeys]);
}
async function scanOneSource(runId, source) {
  await setSourceProgress(runId,source.id,{status:'scanning',started_at:new Date(),current_url:source.url});
  const collected=[]; const visited=new Set(); const queue=[];
  try {
    const rootHtml=await fetchHtml(source.url); visited.add(source.url);
    try { const root$=cheerio.load(rootHtml); const imageUrl=resolveUrl(root$('meta[property=\"og:image\"]').attr('content') || root$('meta[name=\"twitter:image\"]').attr('content'), source.url); if(imageUrl) await db(`UPDATE sources SET image_url=$2,updated_at=NOW() WHERE id=$1`,[source.id,imageUrl]); } catch {}
    let c=listCandidates(rootHtml,source.url,source); collected.push(...c.inline);
    queue.push(...c.links.filter(x=>x!==source.url));
    const rootRecord=pageInfo(rootHtml,source.url,source); if(rootRecord) collected.push(rootRecord);
    await setSourceProgress(runId,source.id,{pages_scanned:1,pages_total:Math.min(queue.length+1,90),current_url:source.url}); await bumpRun(runId,1);
    while(queue.length && visited.size<90) {
      const url=queue.shift(); if(visited.has(url)) continue; visited.add(url);
      await setSourceProgress(runId,source.id,{current_url:url,pages_scanned:visited.size,pages_total:Math.min(Math.max(visited.size+queue.length,visited.size),90)});
      try {
        const html=await fetchHtml(url); const rec=pageInfo(html,url,source); if(rec) collected.push(rec);
        if (visited.size < 25) { const more=listCandidates(html,url,source).links; for(const l of more) if(!visited.has(l)&&queue.length<150) queue.push(l); }
      } catch(e) { /* individual page errors do not kill a source */ }
      await bumpRun(runId,1);
    }
    const merged=mergeTypologies(collected).filter(x=>x.type_name && !/^(tament|tamente)$/i.test(x.type_name));
    await upsertTypologies(source,merged);
    await db(`UPDATE sources SET last_scanned_at=NOW(),updated_at=NOW() WHERE id=$1`,[source.id]);
    await setSourceProgress(runId,source.id,{status:'completed',pages_scanned:visited.size,pages_total:visited.size,types_found:merged.length,current_url:null,finished_at:new Date()});
    await db(`UPDATE scan_runs SET completed_sources=completed_sources+1,types_found=types_found+$2 WHERE id=$1`,[runId,merged.length]);
  } catch(e) {
    await setSourceProgress(runId,source.id,{status:'error',error:e.message,current_url:null,finished_at:new Date()});
    await db(`UPDATE scan_runs SET completed_sources=completed_sources+1 WHERE id=$1`,[runId]);
  }
}
async function executeRun(runId, sourceIds) {
  try {
    const sources=(await sourceList()).filter(s=>sourceIds.includes(s.id));
    for(const s of sources) await scanOneSource(runId,s);
    await db(`UPDATE scan_runs SET status='completed',finished_at=NOW() WHERE id=$1`,[runId]);
  } catch(e) { await db(`UPDATE scan_runs SET status='error',error=$2,finished_at=NOW() WHERE id=$1`,[runId,e.message]); }
}
async function createRun(sourceIds, kind) {
  const id=crypto.randomUUID(); const sources=(await sourceList()).filter(s=>sourceIds.includes(s.id));
  await db(`INSERT INTO scan_runs(id,kind,status,total_sources) VALUES($1,$2,'running',$3)`,[id,kind,sources.length]);
  for(const s of sources) await db(`INSERT INTO scan_source_runs(run_id,source_id,source_name,status) VALUES($1,$2,$3,'queued')`,[id,s.id,s.name]);
  setImmediate(()=>executeRun(id,sourceIds)); return id;
}
async function getRun(id) {
  const run=(await db(`SELECT * FROM scan_runs WHERE id=$1`,[id])).rows[0]; if(!run)return null;
  run.sources=(await db(`SELECT * FROM scan_source_runs WHERE run_id=$1 ORDER BY started_at NULLS LAST,source_name`,[id])).rows; return run;
}
function json(res,status,obj) { const b=JSON.stringify(obj); res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'}); res.end(b); }
async function readBody(req) { return await new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e6){reject(new Error('Body prea mare'));req.destroy();}});req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}});req.on('error',reject)}); }
function serve(res,file) { try { const b=fs.readFileSync(file); const ext=path.extname(file); const ct={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream'; res.writeHead(200,{'content-type':ct});res.end(b);} catch {res.writeHead(404);res.end('Not found');} }

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  try {
    if(u.pathname==='/api/health') return json(res,200,{ok:true,databaseConfigured:!!pool});
    if(!pool && u.pathname.startsWith('/api/')) return json(res,503,{error:'Database not configured. Setează DATABASE_URL în Render.'});
    if(req.method==='GET'&&u.pathname==='/api/sources') return json(res,200,await sourceList());
    if(req.method==='GET'&&u.pathname==='/api/typologies') return json(res,200,await typologyList());
    if(req.method==='POST'&&u.pathname==='/api/sources') {
      const b=await readBody(req); if(!b.url) return json(res,400,{error:'URL obligatoriu'});
      let parsed; try{parsed=new URL(b.url)}catch{return json(res,400,{error:'URL invalid'})}
      const name=norm(b.name)||parsed.hostname.replace(/^www\./,''); let id=slug(name)||'source';
      if((await db(`SELECT 1 FROM sources WHERE id=$1`,[id])).rowCount) id+='-'+Date.now().toString(36);
      await db(`INSERT INTO sources(id,name,url,enabled,city,zone) VALUES($1,$2,$3,TRUE,$4,$5)`,[id,name,parsed.href,b.city||null,b.zone||null]);
      return json(res,201,(await db(`SELECT * FROM sources WHERE id=$1`,[id])).rows[0]);
    }
    if(req.method==='PATCH'&&u.pathname.startsWith('/api/sources/')) {
      const id=decodeURIComponent(u.pathname.split('/').pop()),b=await readBody(req);
      if(typeof b.enabled==='boolean') await db(`UPDATE sources SET enabled=$2,updated_at=NOW() WHERE id=$1`,[id,b.enabled]);
      return json(res,200,(await db(`SELECT * FROM sources WHERE id=$1`,[id])).rows[0]);
    }
    if(req.method==='POST'&&u.pathname==='/api/scan-all') {
      const ids=(await sourceList()).filter(s=>s.enabled).map(s=>s.id); const id=await createRun(ids,'all'); return json(res,202,{jobId:id});
    }
    let m=u.pathname.match(/^\/api\/scan\/([^/]+)$/); if(req.method==='POST'&&m) {
      const s=(await db(`SELECT * FROM sources WHERE id=$1`,[m[1]])).rows[0]; if(!s)return json(res,404,{error:'Sursa nu există'});
      const id=await createRun([s.id],'single'); return json(res,202,{jobId:id});
    }
    m=u.pathname.match(/^\/api\/jobs\/([^/]+)$/); if(req.method==='GET'&&m) { const j=await getRun(m[1]); return j?json(res,200,j):json(res,404,{error:'Job inexistent'}); }
    if(req.method==='GET'&&u.pathname==='/api/latest-job') { const r=(await db(`SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT 1`)).rows[0]; return json(res,200,r?await getRun(r.id):null); }
    const file=u.pathname==='/'?path.join(PUBLIC,'index.html'):path.join(PUBLIC,u.pathname.replace(/^\//,'')); if(!file.startsWith(PUBLIC))return serve(res,''); return serve(res,file);
  } catch(e) { console.error(e); return json(res,500,{error:e.message}); }
});

(async()=>{try{await migrate();server.listen(PORT,()=>console.log('AptCompare Build 3 on :'+PORT));}catch(e){console.error('Startup error',e);server.listen(PORT,()=>console.log('AptCompare started without DB migration'));}})();
