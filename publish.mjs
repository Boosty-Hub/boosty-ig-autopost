// Publica un carrusel de Boosty en Instagram vía API Graph. Corre en GitHub Actions.
// Media servida por GitHub Pages (URLs públicas). Sin dependencias externas (fetch nativo de Node 20).
//
// Env:
//   META_ACCESS_TOKEN  (secret) — token system-user con instagram_content_publish
//   IG_USER_ID         (default 17841421294200897)
//   GRAPH_VERSION      (default v22.0)
//   PAGES_BASE         (p.ej. https://boosty-hub.github.io/boosty-ig-autopost)
//   DRY_RUN            ('true' = valida URLs y arma el plan, NO publica)
//   FORCE_SLUG         (opcional: publica ese slug ignorando la fecha)
import { readFile } from 'node:fs/promises';

const TOKEN = process.env.META_ACCESS_TOKEN;
const IG = process.env.IG_USER_ID || '17841421294200897';
const V = process.env.GRAPH_VERSION || 'v22.0';
const BASE = (process.env.PAGES_BASE || '').replace(/\/$/, '');
const DRY = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const FORCE = process.env.FORCE_SLUG || '';
const API = `https://graph.facebook.com/${V}`;

const die = (m) => { console.error('✖ ' + m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!TOKEN) die('Falta META_ACCESS_TOKEN');
if (!BASE) die('Falta PAGES_BASE');

// fecha VET (UTC-4) de hoy en YYYY-MM-DD
function vetDate() {
  const now = new Date(Date.now() - 4 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

async function gpost(path, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${API}/${path}`, { method: 'POST', body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`POST ${path} → ${JSON.stringify(j.error || j)}`);
  return j;
}
async function gget(path, params = {}) {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${API}/${path}?${q}`);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`GET ${path} → ${JSON.stringify(j.error || j)}`);
  return j;
}
async function head200(url) {
  const r = await fetch(url, { method: 'HEAD' });
  return r.status === 200 ? (r.headers.get('content-type') || '') : `HTTP ${r.status}`;
}

async function main() {
  const sched = JSON.parse(await readFile(new URL('./schedule.json', import.meta.url)));
  const posts = sched.posts || {};
  let entry, key;
  if (FORCE) {
    key = Object.keys(posts).find((k) => posts[k].slug === FORCE) || FORCE;
    entry = posts[key] || Object.values(posts).find((p) => p.slug === FORCE);
    if (!entry) die(`FORCE_SLUG '${FORCE}' no está en schedule.json`);
  } else {
    key = vetDate();
    entry = posts[key];
    if (!entry) { console.log(`ℹ No hay post programado para ${key} (VET). Nada que hacer.`); return; }
  }
  const { slug, videoFirst, caption } = entry;
  console.log(`▶ Publicando ${slug} (${key}) · videoFirst=${videoFirst} · DRY_RUN=${DRY}`);

  const captionText = (await readFile(new URL('./' + caption, import.meta.url), 'utf8')).trim();

  // items: imágenes 01..05 + video, según videoFirst
  const imgs = ['01', '02', '03', '04', '05'].map((n) => `${BASE}/media/${slug}/${n}.jpg`);
  const video = `${BASE}/media/${slug}/video.mp4`;
  const items = videoFirst
    ? [{ type: 'video', url: video }, ...imgs.map((u) => ({ type: 'image', url: u }))]
    : [{ type: 'image', url: imgs[0] }, { type: 'video', url: video }, ...imgs.slice(1).map((u) => ({ type: 'image', url: u }))];

  // verifica que todas las URLs sirvan
  console.log('· Verificando URLs públicas (Pages)…');
  for (const it of items) {
    const ct = await head200(it.url);
    const okType = it.type === 'video' ? ct.includes('mp4') || ct.includes('video') : ct.includes('image') || ct.includes('jpeg');
    console.log(`   ${okType ? '✓' : 'x'} ${ct}  ${it.url}`);
    if (!ct.includes('/') || !okType) die(`URL no sirve o content-type inesperado: ${it.url} (${ct})`);
  }

  // dedup: ¿ya se publicó algo con este mismo inicio de caption?
  const first = captionText.split('\n')[0].slice(0, 40);
  const recent = await gget(`${IG}/media`, { fields: 'caption,timestamp', limit: 5 });
  if ((recent.data || []).some((m) => (m.caption || '').startsWith(first))) {
    console.log(`⏭ Ya existe un post que empieza con "${first}". No duplico.`);
    return;
  }

  if (DRY) { console.log('✅ DRY_RUN ok: URLs válidas y no hay duplicado. (No se publicó.)'); return; }

  // 1) contenedores hijos
  const childIds = [];
  for (const it of items) {
    if (it.type === 'image') {
      const j = await gpost(`${IG}/media`, { image_url: it.url, is_carousel_item: 'true' });
      childIds.push(j.id);
      console.log(`   + imagen ${j.id}`);
    } else {
      const j = await gpost(`${IG}/media`, { media_type: 'VIDEO', video_url: it.url, is_carousel_item: 'true' });
      console.log(`   + video ${j.id} (procesando…)`);
      // espera FINISHED (hasta ~10 min; IG a veces tarda). Tolera blips transitorios de la API.
      let ok = false, last = '';
      for (let i = 0; i < 60; i++) {
        await sleep(10000);
        let s;
        try { s = await gget(j.id, { fields: 'status_code,status' }); }
        catch (e) { console.log(`   (poll ${i + 1}: reintento, ${e.message.slice(0, 60)})`); continue; }
        last = s.status_code || '';
        if (s.status_code === 'FINISHED') { ok = true; console.log(`   video FINISHED (${(i + 1) * 10}s)`); break; }
        if (s.status_code === 'ERROR') throw new Error(`Video ERROR: ${JSON.stringify(s)}`);
      }
      if (!ok) throw new Error(`Video no terminó de procesar a tiempo (último estado: ${last || 'desconocido'})`);
      childIds.push(j.id);
    }
  }

  // 2) contenedor carrusel
  const car = await gpost(`${IG}/media`, { media_type: 'CAROUSEL', children: childIds.join(','), caption: captionText });
  console.log(`   = carrusel ${car.id}`);

  // esperar a que el contenedor del carrusel esté listo (evita 9007 "no está listo")
  for (let i = 0; i < 20; i++) {
    const s = await gget(car.id, { fields: 'status_code' }).catch(() => ({}));
    if (s.status_code === 'FINISHED') { console.log('   carrusel FINISHED'); break; }
    if (s.status_code === 'ERROR') throw new Error(`Carrusel ERROR: ${JSON.stringify(s)}`);
    await sleep(5000);
  }

  // 3) publicar, con reintentos si Instagram responde "aún no listo" (9007 / 2207027)
  let pub;
  for (let i = 0; i < 10; i++) {
    try { pub = await gpost(`${IG}/media_publish`, { creation_id: car.id }); break; }
    catch (e) {
      const notReady = /2207027|\b9007\b|not available|no est[aá] listo/i.test(e.message);
      if (notReady && i < 9) { console.log(`   aún no listo, reintento ${i + 1}/9…`); await sleep(10000); continue; }
      throw e;
    }
  }
  const info = await gget(pub.id, { fields: 'permalink' });
  console.log(`✅ Publicado: ${info.permalink || pub.id}`);
}
main().catch((e) => die(e.message || String(e)));
