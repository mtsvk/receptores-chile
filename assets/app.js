'use strict';

const DATA_PATHS = {
  receptores: 'data/receptores.json',
  comunas: 'data/comunas.json',
  tribunales: 'data/tribunales.json',
  cortes: 'data/cortes.json',
  index: 'data/search-index.json',
  meta: 'data/meta.json'
};

const ADS = [
  { id:'ad-001', title:'Publicidad procesal', text:'Tu receptor no está perdido, solo está en otra Corte.', cta:'Buscar con calma', href:null, emoji:'⚖️', theme:'neutral', placement:'hero' },
  { id:'ad-002', title:'Café con plazo', text:'Café cargado para escritos con plazo vencido. No incluye patrocinio ni poder.', cta:'Respirar', href:null, emoji:'☕', theme:'warm', placement:'results' },
  { id:'ad-003', title:'Diligencia urgente', text:'¿Diligencia urgente? Respira. Primero busca bien la comuna.', cta:'Ver filtros', href:'#filterComuna', emoji:'🧭', theme:'neutral', placement:'hero' },
  { id:'ad-004', title:'Banner con fe pública', text:'Este banner no notifica demandas. Todavía.', cta:'No oficial', href:'#legalNote', emoji:'📬', theme:'dry', placement:'results' },
  { id:'ad-005', title:'Aviso serio pero no tanto', text:'Patrocinado por el miedo a la rebeldía procesal.', cta:'Copiar contacto', href:null, emoji:'😬', theme:'warm', placement:'results' },
  { id:'ad-006', title:'Aquí podría estar tu estudio', text:'Preferimos no cargar scripts raros. Banner local, liviano y sin tracking.', cta:'Sin API publicitaria', href:null, emoji:'🪧', theme:'neutral', placement:'hero' }
];

const MESSAGE_TEMPLATES = {
  diligencia: 'Hola, le escribo porque necesito consultar disponibilidad para diligenciar una actuación judicial en [COMUNA/TRIBUNAL]. ¿Me podría indicar si realiza diligencias en ese territorio y sus condiciones? Gracias.',
  disponibilidad: 'Hola, buenas tardes. Quisiera consultar si tiene disponibilidad para una diligencia en [COMUNA/TRIBUNAL]. Quedo atento/a a sus comentarios. Gracias.',
  causa: 'Hola, necesito consultar por una diligencia en la causa [ROL/RIT], del tribunal [TRIBUNAL], a practicarse en [COMUNA]. ¿Me puede indicar disponibilidad y antecedentes necesarios? Gracias.',
  breve: 'Hola, le escribo para consultar por una diligencia judicial. ¿Tendrá disponibilidad para conversar brevemente? Gracias.',
  felicitacion: 'Hola, solo quería saludar y felicitar por el trabajo. Que tenga muy buen día.',
  personalizada: ''
};

const state = {
  data: { receptores: [], comunas: [], tribunales: [], cortes: [], index: null, meta: null },
  query: '',
  filters: { corte:'', region:'', comuna:'', tipo:'', whatsapp:false, email:false, strong:false },
  results: [],
  visible: []
};

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

function normalizeText(str = '') {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/ñ/g, '__enie__')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/__enie__/g, 'ñ')
    .replace(/°/g, ' ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAliases(query) {
  const aliases = (state.data.index && state.data.index.aliases) || {};
  let out = ` ${normalizeText(query)} `;
  Object.entries(aliases).forEach(([from, to]) => {
    const f = normalizeText(from);
    const t = normalizeText(to);
    out = out.replace(new RegExp(`\\b${escapeRegex(f)}\\b`, 'g'), ` ${t} `);
  });
  return out.replace(/\s+/g, ' ').trim();
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function tokensOf(s) { return normalizeText(s).split(' ').filter(Boolean); }
function includesAny(haystack, needles) { return needles.some(t => haystack.includes(t)); }
function exactTokenHit(haystack, token) { return new RegExp(`(^| )${escapeRegex(token)}( |$)`).test(haystack); }

function normalizePhoneCL(phone) {
  const raw = String(phone || '').trim();
  let d = raw.replace(/\D+/g, '');
  const flags = [];
  if (!d) return { raw, normalized:'', isMobile:false, isValid:false, waNumber:'', flags:['missing_phone'] };
  if (d.startsWith('0056')) d = d.slice(4);
  if (d.startsWith('56')) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 9 || d.length === 10)) d = d.slice(1);
  if (d.length === 9 && d.startsWith('9')) return { raw, normalized:`+56 ${d[0]} ${d.slice(1,5)} ${d.slice(5)}`, isMobile:true, isValid:true, waNumber:`56${d}`, flags };
  if (d.length === 8 && /[6789]/.test(d[0])) return { raw, normalized:`+56 9 ${d.slice(0,4)} ${d.slice(4)}`, isMobile:true, isValid:true, waNumber:`569${d}`, flags:['mobile_8_digit_prefixed_9_verify'] };
  return { raw, normalized:d, isMobile:false, isValid:false, waNumber:'', flags:['not_mobile_or_ambiguous'] };
}

function buildWhatsAppUrl(phone, message) {
  const normalized = normalizePhoneCL(phone);
  if (!normalized.waNumber) return null;
  return `https://wa.me/${normalized.waNumber}?text=${encodeURIComponent(message || '')}`;
}

function selectedPlaceFallback(result) {
  const q = state.query || '';
  if (q.trim()) return q.trim();
  if (state.filters.comuna) return state.filters.comuna;
  return result.tribunal_fuente || result.corte || 'la comuna/tribunal correspondiente';
}

function defaultMessage(result, key='diligencia') {
  const base = MESSAGE_TEMPLATES[key] || MESSAGE_TEMPLATES.diligencia;
  return base.replace('[COMUNA/TRIBUNAL]', selectedPlaceFallback(result))
    .replace('[TRIBUNAL]', result.tribunal_fuente || '')
    .replace('[COMUNA]', state.filters.comuna || '')
    .replace('[ROL/RIT]', '');
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  return Promise.resolve();
}

async function loadData() {
  const entries = await Promise.all(Object.entries(DATA_PATHS).map(async ([key, path]) => {
    const res = await fetch(path, { cache:'no-store' });
    if (!res.ok) throw new Error(`No se pudo cargar ${path}`);
    return [key, await res.json()];
  }));
  entries.forEach(([key, value]) => { state.data[key] = value; });
}

function populateFilters() {
  fillSelect('#filterCourt', unique(state.data.receptores.map(r => r.corte)).sort());
  fillSelect('#filterRegion', unique(state.data.comunas.map(c => c.region)).sort());
  fillSelect('#filterComuna', unique(state.data.comunas.map(c => c.nombre)).sort((a,b)=>a.localeCompare(b, 'es')));
}
function unique(arr) { return [...new Set(arr.filter(Boolean))]; }
function fillSelect(selector, values) {
  const select = $(selector);
  const first = select.options[0];
  select.innerHTML = '';
  select.appendChild(first);
  values.forEach(value => {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = value;
    select.appendChild(opt);
  });
}

function inferTipoRecord(r) {
  const t = normalizeText(`${r.tribunal_fuente || ''} ${r.tribunales_relacionados?.join(' ') || ''}`);
  if (t.includes('garantia')) return 'garantia';
  if (t.includes('juicio oral') || t.includes('penal')) return 'penal';
  if (t.includes('corte de apelaciones')) return 'corte';
  if (t.includes('civil') || t.includes('letras')) return 'civil';
  return '';
}

function haystacks(r) {
  return {
    name: r.nombre_normalizado || normalizeText(r.nombre),
    corte: r.corte_normalizada || normalizeText(r.corte),
    tribunal: normalizeText(`${r.tribunal_fuente || ''} ${(r.tribunales_relacionados || []).join(' ')}`),
    comuna: normalizeText((r.comunas_cubiertas || []).join(' ')),
    region: normalizeText((r.regiones || []).join(' ')),
    phone: normalizeText(`${r.telefono || ''} ${r.telefono_fijo || ''} ${r.telefono_whatsapp_normalizado || ''}`),
    all: normalizeText([r.nombre, r.corte, r.tribunal_fuente, (r.comunas_cubiertas || []).join(' '), (r.regiones || []).join(' '), r.telefono, r.telefono_fijo, r.email].join(' '))
  };
}

function rankOne(r, rawQuery) {
  const query = expandAliases(rawQuery);
  const h = haystacks(r);
  const toks = tokensOf(query);
  let score = 0;
  const reasons = [];
  if (!query) { score = (r.confidence_score || 0) * 8; reasons.push('Listado inicial'); }
  if (query) {
    if (h.name === query) { score += 130; reasons.push('Coincidencia exacta por nombre'); }
    else if (h.name.startsWith(query)) { score += 95; reasons.push('Coincide al inicio del nombre'); }
    else if (h.name.includes(query)) { score += 70; reasons.push('Coincide por nombre'); }
    if (h.comuna.includes(query)) { score += 90; reasons.push('Coincide por comuna cubierta'); }
    if (h.tribunal.includes(query)) { score += 80; reasons.push('Coincide por tribunal'); }
    if (h.corte.includes(query)) { score += 70; reasons.push('Coincide por Corte'); }
    if (h.region.includes(query)) { score += 45; reasons.push('Coincide por región'); }
    if (h.phone.includes(query.replace(/\s/g,''))) { score += 75; reasons.push('Coincide por teléfono'); }
    toks.forEach(tok => {
      if (tok.length < 2) return;
      if (exactTokenHit(h.name, tok)) score += 18;
      else if (h.name.includes(tok)) score += 10;
      if (exactTokenHit(h.comuna, tok)) score += 20;
      else if (h.comuna.includes(tok)) score += 10;
      if (exactTokenHit(h.tribunal, tok)) score += 16;
      else if (h.tribunal.includes(tok)) score += 8;
      if (exactTokenHit(h.corte, tok)) score += 14;
      if (exactTokenHit(h.region, tok)) score += 9;
    });
    if (toks.length && toks.every(tok => h.all.includes(tok))) { score += 30; reasons.push('Coincidencia combinada'); }
  }
  if (r.telefono_valido_whatsapp) { score += 8; if (query) reasons.push('Teléfono disponible para WhatsApp'); }
  if (r.email) score += 4;
  score += Math.round((r.confidence_score || 0) * 10);
  if ((r.flags_calidad || []).includes('missing_mobile')) score -= 8;
  if ((r.flags_calidad || []).includes('no_territory_inferred')) score -= 20;
  return { ...r, _score: Math.max(0, score), _reasons: unique(reasons).slice(0,5) };
}

function passesFilters(r) {
  const f = state.filters;
  if (f.corte && r.corte !== f.corte) return false;
  if (f.region && !(r.regiones || []).includes(f.region)) return false;
  if (f.comuna && !(r.comunas_cubiertas || []).includes(f.comuna)) return false;
  if (f.tipo && inferTipoRecord(r) !== f.tipo) return false;
  if (f.whatsapp && !r.telefono_valido_whatsapp) return false;
  if (f.email && !r.email) return false;
  return true;
}

function rankResults(query, data, filters = state.filters) {
  state.filters = filters;
  const ranked = data.map(r => rankOne(r, query)).filter(passesFilters);
  const min = filters.strong ? Math.max(55, query ? 45 : 0) : (query ? 8 : 0);
  return ranked.filter(r => r._score >= min).sort((a,b) => b._score - a._score || a.nombre.localeCompare(b.nombre, 'es'));
}

function explainMatch(result) {
  const reasons = result._reasons || [];
  if ((result.flags_calidad || []).includes('santiago_san_miguel_rule')) reasons.push('Regla Santiago/San Miguel');
  if (!result.telefono_valido_whatsapp) reasons.push('Dato incompleto: sin WhatsApp válido');
  return unique(reasons).slice(0,6);
}

function renderResults(results) {
  const container = $('#results');
  state.visible = results.slice(0, 80);
  $('#resultCount').textContent = `${results.length} resultado${results.length === 1 ? '' : 's'}`;
  $('#resultHint').textContent = state.query ? `para “${state.query}”` : 'en listado inicial ordenado por completitud.';
  if (!state.visible.length) {
    container.innerHTML = `<div class="result-card empty"><h2>No encontré resultados fuertes.</h2><p>Prueba con comuna, Corte o tribunal: “Puente Alto”, “San Miguel”, “Viña”, “garantía Maipú”. También puedes desactivar “solo coincidencias fuertes”.</p></div>`;
    return;
  }
  container.innerHTML = state.visible.map(renderCard).join('');
}

function renderCard(r) {
  const badges = explainMatch(r).map(reason => {
    const cls = /incompleto|sin WhatsApp|verificar/i.test(reason) ? 'warn' : (/WhatsApp|Coincide|Regla/i.test(reason) ? 'ok' : '');
    return `<span class="badge ${cls}">${escapeHtml(reason)}</span>`;
  }).join('');
  const comunas = (r.comunas_cubiertas || []).slice(0, 6).join(', ') + ((r.comunas_cubiertas || []).length > 6 ? '…' : '');
  const contact = r.telefono_valido_whatsapp ? r.telefono_normalizado : (r.telefono_fijo ? `Fijo: ${escapeHtml(r.telefono_fijo)}` : 'Sin teléfono útil');
  const waDisabled = r.telefono_valido_whatsapp ? '' : 'disabled aria-disabled="true"';
  return `<article class="result-card" data-id="${escapeHtml(r.id)}">
    <div class="card-top">
      <h2 class="card-title">${escapeHtml(r.nombre)}</h2>
      <span class="score">score ${Math.round(r._score)}</span>
    </div>
    <div class="meta-grid">
      <div><strong>Corte</strong><br>${escapeHtml(r.corte || 'Desconocida')}</div>
      <div><strong>Tribunal fuente</strong><br>${escapeHtml(r.tribunal_fuente || 'No informado')}</div>
      <div><strong>Comunas</strong><br>${escapeHtml(comunas || 'No inferidas')}</div>
      <div><strong>Contacto</strong><br>${escapeHtml(contact)}${r.email ? `<br>${escapeHtml(r.email)}` : ''}</div>
    </div>
    <div class="badges">${badges}</div>
    <div class="card-actions">
      <button class="primary" type="button" data-action="whatsapp" data-id="${escapeHtml(r.id)}" ${waDisabled}>WhatsApp</button>
      <button type="button" data-action="copy-contact" data-id="${escapeHtml(r.id)}">Copiar contacto</button>
      <button type="button" data-action="copy-message" data-id="${escapeHtml(r.id)}">Copiar mensaje</button>
      <button type="button" data-action="detail" data-id="${escapeHtml(r.id)}">Ver detalle</button>
    </div>
  </article>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function contactText(r) {
  return [
    r.nombre,
    r.corte,
    r.tribunal_fuente ? `Tribunal: ${r.tribunal_fuente}` : '',
    r.telefono_normalizado ? `Celular: ${r.telefono_normalizado}` : '',
    r.telefono_fijo ? `Fijo: ${r.telefono_fijo}` : '',
    r.email ? `Email: ${r.email}` : '',
    `Fuente: ${r.fuente}`,
    'No oficial: verificar vigencia antes de diligenciar.'
  ].filter(Boolean).join('\n');
}

function openWhatsApp(r) {
  const url = buildWhatsAppUrl(r.telefono_whatsapp_normalizado || r.telefono, defaultMessage(r));
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function openDetail(r) {
  const dialog = $('#detailDialog');
  const msg = defaultMessage(r);
  const waUrl = buildWhatsAppUrl(r.telefono_whatsapp_normalizado || r.telefono, msg);
  $('#detailContent').innerHTML = `<div class="detail-body">
    <span class="status-pill">${r.telefono_valido_whatsapp ? 'WhatsApp disponible' : 'Sin WhatsApp válido'} · confianza ${Math.round((r.confidence_score || 0)*100)}%</span>
    <h2>${escapeHtml(r.nombre)}</h2>
    <div class="detail-grid">
      <section class="detail-box"><h3>Contacto</h3><p>${escapeHtml(r.telefono_normalizado || 'Celular no disponible')}</p><p>${escapeHtml(r.telefono_fijo ? 'Fijo: '+r.telefono_fijo : 'Sin fijo informado')}</p><p>${escapeHtml(r.email || 'Sin email informado')}</p></section>
      <section class="detail-box"><h3>Territorio</h3><p>${escapeHtml(r.corte)}</p><p>${escapeHtml(r.tribunal_fuente || '')}</p><p>${escapeHtml((r.regiones || []).join(', '))}</p></section>
      <section class="detail-box"><h3>Comunas cubiertas / inferidas</h3><div class="list-pills">${(r.comunas_cubiertas || []).map(c => `<span>${escapeHtml(c)}</span>`).join('') || '<span>No inferidas</span>'}</div></section>
      <section class="detail-box"><h3>Fuente y advertencias</h3><p>${escapeHtml(r.fuente)}</p><p>${escapeHtml(r.fecha_fuente || '')}</p><p>${escapeHtml((r.flags_calidad || []).join(', ') || 'Sin flags críticos')}</p><p>${escapeHtml(r.notas || 'Verificar vigencia antes de encargar la diligencia.')}</p></section>
    </div>
    <div class="template-area">
      <label>Plantilla de mensaje
        <select id="templateSelect">
          <option value="diligencia">Solicitud de diligencia</option>
          <option value="disponibilidad">Consulta de disponibilidad</option>
          <option value="causa">Envío de datos de causa</option>
          <option value="breve">Mensaje breve y cordial</option>
          <option value="felicitacion">Felicitación / amistoso</option>
          <option value="personalizada">Personalizado</option>
        </select>
      </label>
      <textarea id="messageText">${escapeHtml(msg)}</textarea>
    </div>
    <div class="detail-actions">
      ${waUrl ? `<a class="primary" id="detailWa" href="${escapeHtml(waUrl)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>` : '<button class="primary" disabled>WhatsApp no disponible</button>'}
      <button type="button" id="detailCopyContact">Copiar contacto</button>
      <button type="button" id="detailCopyMessage">Copiar mensaje</button>
    </div>
  </div>`;
  dialog.showModal();
  $('#templateSelect').addEventListener('change', (ev) => {
    $('#messageText').value = defaultMessage(r, ev.target.value);
    const link = $('#detailWa');
    const next = buildWhatsAppUrl(r.telefono_whatsapp_normalizado || r.telefono, $('#messageText').value);
    if (link && next) link.href = next;
  });
  $('#messageText').addEventListener('input', () => {
    const link = $('#detailWa');
    const next = buildWhatsAppUrl(r.telefono_whatsapp_normalizado || r.telefono, $('#messageText').value);
    if (link && next) link.href = next;
  });
  $('#detailCopyContact').addEventListener('click', () => copyToClipboard(contactText(r)));
  $('#detailCopyMessage').addEventListener('click', () => copyToClipboard($('#messageText').value));
}

function applySearch() {
  state.query = $('#searchInput').value.trim();
  state.filters = {
    corte: $('#filterCourt').value,
    region: $('#filterRegion').value,
    comuna: $('#filterComuna').value,
    tipo: $('#filterTipo').value,
    whatsapp: $('#filterWhatsapp').checked,
    email: $('#filterEmail').checked,
    strong: $('#filterStrong').checked
  };
  state.results = rankResults(state.query, state.data.receptores, state.filters);
  renderResults(state.results);
}

function rotateAds() {
  const pick = (placement) => {
    const pool = ADS.filter(a => a.placement === placement || placement === 'any');
    return pool[Math.floor(Math.random() * pool.length)] || ADS[0];
  };
  const render = (el, ad) => {
    if (!el || !ad) return;
    el.innerHTML = `<div><strong>${escapeHtml(ad.emoji)} ${escapeHtml(ad.title)}</strong><p>${escapeHtml(ad.text)}</p></div>${ad.href ? `<a href="${escapeHtml(ad.href)}">${escapeHtml(ad.cta)}</a>` : `<span class="status-pill">${escapeHtml(ad.cta)}</span>`}`;
  };
  render($('#heroAd'), pick('hero'));
  render($('#sideAd'), pick('results'));
}

function bindEvents() {
  $('#searchForm').addEventListener('submit', (ev) => { ev.preventDefault(); applySearch(); });
  $('#searchInput').addEventListener('input', debounce(applySearch, 120));
  ['#filterCourt','#filterRegion','#filterComuna','#filterTipo','#filterWhatsapp','#filterEmail','#filterStrong'].forEach(sel => $(sel).addEventListener('change', applySearch));
  $$('.quick-examples button').forEach(btn => btn.addEventListener('click', () => { $('#searchInput').value = btn.dataset.query; applySearch(); }));
  $('#results').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const r = state.data.receptores.find(x => x.id === btn.dataset.id);
    if (!r) return;
    if (btn.dataset.action === 'whatsapp') openWhatsApp(r);
    if (btn.dataset.action === 'copy-contact') copyToClipboard(contactText(r));
    if (btn.dataset.action === 'copy-message') copyToClipboard(defaultMessage(r));
    if (btn.dataset.action === 'detail') openDetail(r);
  });
  $('#copyVisibleBtn').addEventListener('click', () => copyToClipboard(state.visible.map(contactText).join('\n\n---\n\n')));
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#closeDialog').addEventListener('click', () => $('#detailDialog').close());
  $('#aboutBtn').addEventListener('click', () => $('#aboutDialog').showModal());
  $('#closeAbout').addEventListener('click', () => $('#aboutDialog').close());
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('receptores-theme', next);
}
function restoreTheme() {
  const saved = localStorage.getItem('receptores-theme');
  if (saved) document.documentElement.dataset.theme = saved;
}
function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
function rotatePlaceholder() {
  const input = $('#searchInput');
  const texts = ['Busca por comuna: Maipú, Viña, Temuco…','Busca por tribunal: 7° Juzgado Civil…','Busca por receptor…','Busca por Corte: Santiago, San Miguel…','Busca: Puente Alto, garantía, civil…'];
  let i = 0;
  setInterval(() => { if (!input.value) input.placeholder = texts[(++i) % texts.length]; }, 2400);
}
function renderMeta() {
  const meta = state.data.meta;
  if (!meta) return;
  $('#sourceMeta').textContent = `${meta.conteos.receptores} receptores · ${meta.conteos.receptores_con_whatsapp} con WhatsApp normalizado · ${meta.conteos.comunas} comunas · generado ${meta.generado}.`;
}

async function init() {
  restoreTheme(); rotateAds(); rotatePlaceholder(); bindEvents();
  try {
    await loadData();
    populateFilters(); renderMeta(); applySearch();
    setInterval(rotateAds, 11000);
  } catch (err) {
    console.error(err);
    $('#results').innerHTML = `<div class="result-card empty"><h2>No se pudieron cargar los JSON.</h2><p>Para probar localmente usa un servidor estático, por ejemplo VS Code Live Server, Neocities, GitHub Pages o Cloudflare Pages.</p></div>`;
    $('#resultCount').textContent = 'Error al cargar fuentes';
    $('#resultHint').textContent = err.message;
  }
}

document.addEventListener('DOMContentLoaded', init);
