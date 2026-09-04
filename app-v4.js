(() => {
"use strict";

const DATA_URL = "data/receptores.json";
const CONTACT_NAMES_URL = "data/nombres_contacto.csv";
const META_URL = "data/meta.json";
const COMUNAS_URL = "data/comunas.json";
const CORTES_URL = "data/cortes.json";
const PAGE = 60;
const COURT_GRID_ORDER = ["arica","iquique","antofagasta","copiapo","la serena","valparaiso","santiago","san miguel","rancagua","talca","chillan","concepcion","temuco","valdivia","puerto montt","coyhaique","punta arenas"];
const COURT_GRID_ALIASES = new Map([["coihaique", "coyhaique"]]);
const ESTIMATED = new Set(["territory_inferred_from_court_not_specific_tribunal","court_level_assignment"]);
const REGION_ORDER = ["Arica y Parinacota","Tarapacá","Antofagasta","Atacama","Coquimbo","Valparaíso","Metropolitana de Santiago","Libertador General Bernardo O'Higgins","Maule","Ñuble","Biobío","La Araucanía","Los Ríos","Los Lagos","Aysén del General Carlos Ibáñez del Campo","Magallanes y de la Antártica Chilena"];

const $ = id => document.getElementById(id);
const els = {
  q:$("q"), clear:$("clear"), corte:$("corte"), region:$("region"), comuna:$("comuna"),
  contacto:$("contacto"), reset:$("reset"), status:$("status"),
  dataset:$("dataset"), list:$("list"), empty:$("empty"), filterSummary:$("filterSummary"),
  moreWrap:$("moreWrap"), more:$("more"), error:$("error"), explore:$("explorar"), courtGrid:$("courtGrid"), showAll:$("showAll"), sort:$("sort")
};

let rows = [];
let filtered = [];
let visible = PAGE;
let browseAll = false;
let comunaInfo = new Map();
let corteInfo = [];
let contactNames = new Map();

init();

async function init() {
  bind();
  try {
    const [dataRes, metaRes, comunasRes, cortesRes, contactNamesRes] = await Promise.all([
      fetch(DATA_URL),
      fetch(META_URL).catch(() => null),
      fetch(COMUNAS_URL).catch(() => null),
      fetch(CORTES_URL).catch(() => null),
      fetch(CONTACT_NAMES_URL).catch(() => null)
    ]);
    if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status} al cargar receptores.json`);
    const raw = await dataRes.json();
    if (!Array.isArray(raw)) throw new Error("receptores.json no contiene una lista válida");

    rows = raw.map(prepare).sort(byName);

    let meta = null;
    try {
      if (metaRes?.ok) meta = await metaRes.json();
    } catch (_) {}

    try {
      if (comunasRes?.ok) {
        const comunas = await comunasRes.json();
        comunaInfo = new Map(comunas.flatMap(c => [c.nombre, ...(c.variantes || [])].filter(Boolean).map(name => [norm(name), c])));
      }
      if (cortesRes?.ok) corteInfo = await cortesRes.json();
      if (contactNamesRes?.ok) contactNames = parseContactAudit(await contactNamesRes.text());
    } catch (_) {}

    fillFilters();
    restoreUrl();
    renderMeta(meta);
    renderCourts();
    apply(false);
  } catch (err) {
    console.error(err);
    els.status.textContent = "No fue posible cargar el directorio";
    els.error.hidden = false;
    els.error.textContent = `Error: ${err.message}`;
  }
}

function bind() {
  let timer;
  els.q.addEventListener("input", () => {
    browseAll = true;
    els.clear.hidden = !els.q.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!hasActiveContext()) browseAll = false;
      visible = PAGE;
      apply();
    }, 90);
  });
  els.clear.addEventListener("click", () => {
    els.q.value = "";
    els.clear.hidden = true;
    browseAll = false;
    visible = PAGE;
    apply();
    els.q.focus();
  });
  [els.corte, els.region, els.comuna, els.contacto].forEach(el => el.addEventListener("change", () => {
    browseAll = true;
    if (el === els.region) {
      populateComunaOptions();
      els.comuna.value = "";
    }
    visible = PAGE;
    apply();
  }));
  els.reset.addEventListener("click", () => {
    els.q.value = "";
    els.clear.hidden = true;
    browseAll = false;
    els.corte.value = "";
    els.region.value = "";
    els.comuna.value = "";
    els.contacto.value = "";
    visible = PAGE;
    apply();
    els.q.focus();
  });
  els.more.addEventListener("click", () => {
    visible += PAGE;
    render();
  });
  els.showAll.addEventListener("click", () => { browseAll = true; els.q.value = ""; els.clear.hidden = true; els.corte.value = ""; els.region.value = ""; els.comuna.value = ""; els.contacto.value = ""; visible = PAGE; apply(); els.list.scrollIntoView({ behavior:"smooth", block:"start" }); });
  els.courtGrid.addEventListener("click", event => { const button = event.target.closest("[data-court]"); if (!button) return; browseAll = true; els.corte.value = button.dataset.court; visible = PAGE; apply(); els.list.scrollIntoView({ behavior:"smooth", block:"start" }); });
  els.sort.addEventListener("change", () => apply(false));
}

function prepare(r) {
  const comunas = arr(r.comunas_cubiertas);
  const tribunales = arr(r.tribunales_relacionados);
  const emails = arr(r.emails).length ? arr(r.emails) : (r.email ? [r.email] : []);
  const flags = arr(r.flags_calidad);

  const phones = buildPhones(r);
  const inferredContact = inferContactName(r.nombre_original || r.nombre || "");
  const contactOverride = contactNames.get(contactSlug(r.id)) || {};
  const searchBits = [
    r.nombre, r.nombre_original, r.corte, r.territorio, r.tribunal_fuente,
    ...comunas, ...tribunales, ...emails,
    r.telefono, r.telefono_fijo, r.telefono_celular_display, r.telefono_fijo_display,
    ...phones.flatMap(p => [p.display, p.digits])
  ].filter(Boolean);

  return {
    ...r,
    comunas,
    tribunales,
    emails,
    flags,
    phones,
    displayName: contactOverride.nombre_override || inferredContact.nombre_contacto || r.nombre || r.nombre_original || "Sin nombre",
    contactName: contactOverride.nombre_override || inferredContact.nombre_contacto,
    contactGivenNames: contactOverride.nombres_override || inferredContact.nombres_contacto,
    contactSurnames: contactOverride.apellidos_override || inferredContact.apellidos_contacto,
    estimated: flags.some(f => ESTIMATED.has(f)),
    search: norm(searchBits.join(" ")),
    corteKey: norm(r.corte || ""),
    comunaKeys: new Set(comunas.map(norm)),
    regionKeys: new Set(arr(r.regiones).map(norm))
  };
}

function buildPhones(r) {
  const raw = [
    ...splitPhones(r.telefono_celular_display || r.telefono || ""),
    ...splitPhones(r.telefono_fijo_display || r.telefono_fijo || "")
  ];

  const existing = arr(r.tel_links_seguros)
    .map(v => String(v))
    .filter(v => /^tel:\+\d{10,15}$/.test(v))
    .map(v => {
      const d = digits(v).replace(/^56/, "");
      return { digits:d, href:v, display:formatNational(d), whatsapp:d.length===9 && d.startsWith("9") };
    });

  const generated = raw.map(v => {
    let d = digits(v);
    if (d.startsWith("0056")) d = d.slice(4);
    else if (d.startsWith("56") && d.length >= 10) d = d.slice(2);

    if (d.length === 8) {
      d = "9" + d;
      return {digits:d, href:`tel:+56${d}`, display:formatNational(d), whatsapp:true};
    }
    if (d.length === 9) {
      return {digits:d, href:`tel:+56${d}`, display:formatNational(d), whatsapp:d.startsWith("9")};
    }
    return {digits:d, href:"", display:v, whatsapp:false};
  });

  const map = new Map();
  [...existing, ...generated].forEach(p => {
    const key = p.digits || p.display;
    if (!key) return;
    const prev = map.get(key);
    if (!prev || (!prev.href && p.href)) map.set(key, p);
  });
  return [...map.values()];
}

function fillFilters() {
  options(els.corte, unique(rows.map(r => r.corte).filter(Boolean)).sort(compareCourts), x => x.replace(/^Corte de Apelaciones de\s+/i,""));
  options(els.region, unique(rows.flatMap(r => r.regiones)).sort((a,b) => regionRank(a) - regionRank(b) || compareGeographic(a,b)), x => x);
  populateComunaOptions();
}

function populateComunaOptions() {
  const selectedRegion = norm(els.region.value);
  els.comuna.replaceChildren(new Option("Todas las comunas", ""));
  const values = unique(rows.filter(r => !selectedRegion || r.regionKeys.has(selectedRegion)).flatMap(r => r.comunas));
  groupedComunaOptions(els.comuna, values);
}

function options(select, values, label) {
  const frag = document.createDocumentFragment();
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = label(v);
    frag.appendChild(o);
  });
  select.appendChild(frag);
}

function groupedComunaOptions(select, values) {
  const groups = new Map(REGION_ORDER.map(region => [region, []]));
  const ungrouped = [];
  values.forEach(value => { const region = comunaInfo.get(norm(value))?.region; if (region && groups.has(canonicalRegion(region))) groups.get(canonicalRegion(region)).push(value); else ungrouped.push(value); });
  groups.forEach((group, region) => { if (group.length) { const optgroup = document.createElement("optgroup"); optgroup.label = region; group.sort(compareGeographic).forEach(value => appendOption(optgroup, value, value)); select.appendChild(optgroup); } });
  ungrouped.sort(compareGeographic).forEach(value => appendOption(select, value, value));
}

function appendOption(parent, value, label) { const option = document.createElement("option"); option.value = value; option.textContent = label; parent.appendChild(option); }

function renderMeta(meta) {
  const total = meta?.conteos?.receptores || rows.length;
  const date = meta?.fuente_directorio?.fecha_extraccion || meta?.generado || "";
  els.dataset.textContent = `${fmt(total)} receptores${date ? " · actualización " + formatDate(date) : ""}`;
}

function renderCourts() {
  const counts = new Map();
  rows.forEach(r => { if (r.corte) counts.set(r.corte, (counts.get(r.corte) || 0) + 1); });
  els.courtGrid.replaceChildren(...[...counts.keys()].sort((a, b) => courtGridRank(a) - courtGridRank(b)).map(corte => {
    const button = document.createElement("button"); button.type = "button"; button.className = "court-tile"; button.dataset.court = corte;
    const name = document.createElement("span"); name.className = "court-tile-name"; name.textContent = courtGridLabel(corte);
    const count = document.createElement("span"); count.className = "court-tile-count"; count.textContent = `${fmt(counts.get(corte))} receptores`;
    button.append(name, count); return button;
  }));
}

function apply(updateUrl = true) {
  const tokens = norm(els.q.value).split(/\s+/).filter(Boolean);
  const corte = norm(els.corte.value);
  const region = norm(els.region.value);
  const comuna = norm(els.comuna.value);
  const contacto = els.contacto.value;

  filtered = rows.filter(r => {
    if (corte && r.corteKey !== corte) return false;
    if (region && !r.regionKeys.has(region)) return false;
    if (comuna && !r.comunaKeys.has(comuna)) return false;
    if (contacto === "email" && !r.emails.length) return false;
    if (contacto === "phone" && !r.phones.length) return false;
    if (contacto === "whatsapp" && !r.phones.some(p => p.whatsapp)) return false;
    if (tokens.length && !tokens.every(t => r.search.includes(t))) return false;
    return true;
  });

  if (updateUrl) saveUrl();
  filtered.sort(compareResults);
  render();
}

function render() {
  const shown = filtered.slice(0, visible);
  updateSortLabel();
  els.list.replaceChildren(...shown.map(compactCard));
  const hasContext = hasActiveContext();
  els.explore.hidden = hasContext || browseAll;
  document.querySelector(".results").hidden = !hasContext && !browseAll;
  els.empty.hidden = filtered.length !== 0;
  const active = [els.q.value.trim(), els.corte.value, els.region.value, els.comuna.value, els.contacto.value].filter(Boolean);
  els.filterSummary.hidden = !active.length;
  els.filterSummary.textContent = active.join(" · ");
  els.moreWrap.hidden = shown.length >= filtered.length;
  if (!filtered.length) {
    els.status.textContent = "0 receptores";
  } else if (shown.length < filtered.length) {
    els.status.textContent = `${fmt(filtered.length)} receptores · mostrando ${fmt(shown.length)}`;
    els.more.textContent = `Mostrar ${fmt(Math.min(PAGE, filtered.length - shown.length))} más`;
  } else {
    els.status.textContent = `${fmt(filtered.length)} receptor${filtered.length === 1 ? "" : "es"}`;
  }
}

function card(r) {
  const article = document.createElement("article");
  article.className = "card";
  if (r.id) article.id = r.id;

  const a = document.createElement("div");
  a.className = "card-main";
  const name = document.createElement("h3");
  name.className = "name";
  if (r.id) {
    const nameLink = document.createElement("a");
    nameLink.href = canonicalUrl(r);
    nameLink.textContent = r.displayName;
    name.appendChild(nameLink);
  } else {
    name.textContent = r.displayName;
  }
  a.appendChild(name);
  const role = document.createElement("p");
  role.className = "role";
  role.textContent = "Receptor judicial";
  a.appendChild(role);
  const b = document.createElement("div");
  b.className = "card-jurisdiction";
  if (r.corte) {
    const court = document.createElement("p");
    court.className = "court";
    court.textContent = r.corte;
    b.appendChild(court);
  }
  const tribunal = document.createElement("p");
  tribunal.className = "tribunal";
  tribunal.textContent = r.tribunal_fuente || r.territorio || "Adscripción no informada";
  b.appendChild(tribunal);
  const representative = r.comunas[0] || r.territorio || "";
  const region = sortRegions(r.regiones)[0] || "";
  const location = [representative, region].filter(Boolean).join(" · ");
  if (location) {
    const place = document.createElement("p");
    place.className = "location";
    place.textContent = location;
    b.appendChild(place);
  }
  if (r.comunas.length > 1) {
    const coverage = document.createElement("p");
    coverage.className = "coverage-count";
    coverage.textContent = `Cobertura en ${fmt(r.comunas.length)} comunas`;
    b.appendChild(coverage);
  }
  const c = document.createElement("div");
  c.className = "card-footer";
  const wa = r.phones.find(p => p.whatsapp && p.digits);
  const actions = document.createElement("div");
  actions.className = "actions contact-actions";
  if (wa) {
    const link = document.createElement("a");
    link.className = "contact-link";
    link.href = `https://wa.me/56${wa.digits}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "WhatsApp";
    actions.appendChild(link);
  }
  const phone = r.phones.find(p => p.href);
  if (phone) {
    const link = document.createElement("a");
    link.className = "contact-link";
    link.href = phone.href;
    link.textContent = "Llamar";
    actions.appendChild(link);
  }
  if (r.emails[0]) {
    const link = document.createElement("a");
    link.className = "contact-link";
    link.href = `mailto:${r.emails[0]}`;
    link.textContent = "Correo";
    actions.appendChild(link);
  }
  if (r.id) {
    const contactButton = document.createElement("button");
    contactButton.type = "button";
    contactButton.className = "action-button";
    contactButton.textContent = "Guardar contacto";
    contactButton.addEventListener("click", () => downloadVCard(r));
    actions.appendChild(contactButton);

    const detailLink = document.createElement("a");
    detailLink.className = "action-link";
    detailLink.href = canonicalUrl(r);
    detailLink.textContent = "Ver ficha completa →";
    actions.appendChild(detailLink);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-link";
    button.textContent = "Copiar enlace";
    button.addEventListener("click", () => copyLink(button, canonicalUrl(r)));
    actions.appendChild(button);
  }
  if (actions.childNodes.length) c.appendChild(actions);
  if (r.id && window.ReceptoresRatings) c.appendChild(window.ReceptoresRatings.widget(r.id, { compact:true }));

  article.append(a,b,c);
  return article;
}

function compactCard(r) {
  const article = document.createElement("article");
  article.className = "card compact-result";
  if (r.id) article.id = r.id;

  const main = document.createElement("div"); main.className = "card-main";
  const name = document.createElement("h3"); name.className = "name";
  if (r.id) { const link = document.createElement("a"); link.href = canonicalUrl(r); link.textContent = r.displayName; name.appendChild(link); }
  else name.textContent = r.displayName;
  main.appendChild(name);

  const info = document.createElement("div"); info.className = "card-jurisdiction";
  const representative = representativeLocation(r);
  const region = sortRegions(r.regiones)[0] || "";
  const location = [representative, region, r.corte].filter(Boolean).join(" · ");
  if (location) { const place = document.createElement("p"); place.className = "location"; place.textContent = location; info.appendChild(place); }
  if (r.tribunal_fuente || r.territorio) { const tribunal = document.createElement("p"); tribunal.className = "tribunal"; tribunal.textContent = r.tribunal_fuente || r.territorio; info.appendChild(tribunal); }
  if (r.comunas.length) {
    const coverage = document.createElement("p"); coverage.className = "coverage-count";
    coverage.textContent = `Cobertura en ${fmt(r.comunas.length)} comuna${r.comunas.length === 1 ? "" : "s"}`; info.appendChild(coverage);
  }

  const footer = document.createElement("div"); footer.className = "card-footer";
  const actions = document.createElement("div"); actions.className = "actions contact-actions";
  const wa = r.phones.find(p => p.whatsapp && p.digits);
  const phone = r.phones.find(p => p.href);
  if (wa) actions.appendChild(contactLink(arr(r.whatsapp_links_seguros)[0] || `https://wa.me/56${wa.digits}`, "Contactar por WhatsApp", "whatsapp", true));
  if (phone) actions.appendChild(contactLink(phone.href, "Llamar", "phone"));
  if (r.emails[0]) actions.appendChild(contactLink(`mailto:${r.emails[0]}`, "Enviar correo", "email"));
  if (r.id) { const detail = document.createElement("a"); detail.className = "action-link"; detail.href = canonicalUrl(r); detail.textContent = "Ver perfil →"; actions.appendChild(detail); }
  footer.appendChild(actions); article.append(main, info, footer); return article;
}

function compareResults(a, b) { return els.sort.value === "name" ? byName(a, b) : score(b) - score(a) || byName(a, b); }
function score(r) {
  const tokens = norm(els.q.value).split(/\s+/).filter(Boolean); if (!tokens.length) return 0;
  const name = norm([r.displayName, r.nombre, r.nombre_original].filter(Boolean).join(" "));
  const tribunal = norm([r.tribunal_fuente, r.territorio, ...r.tribunales].filter(Boolean).join(" "));
  const comuna = norm(r.comunas.join(" ")); const corte = norm(r.corte || "");
  return tokens.reduce((total, token) => total + (name.includes(token) ? 100 : 0) + (tribunal.includes(token) ? 50 : 0) + (comuna.includes(token) ? 35 : 0) + (corte.includes(token) ? 20 : 0), 0);
}

const CONTACT_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.7 7.9c.2-.3.5-.3.8-.1l1.1 1.1c.2.2.2.5.1.7l-.5.7c.6 1.1 1.5 2 2.6 2.6l.7-.5c.2-.1.5-.1.7.1l1.1 1.1c.2.2.2.6-.1.8-.5.5-1.2.8-1.9.6-2-.5-4.6-3.1-5.1-5.1-.2-.7.1-1.4.6-1.9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m7.1 16.9-.5 2 2-.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.3 4.3 9.7 3.5l1.6 4.1-1.8 1.3a13.3 13.3 0 0 0 5.6 5.6l1.3-1.8 4.1 1.6-.8 2.4c-.3 1-1.3 1.6-2.3 1.4A16.1 16.1 0 0 1 5.9 6.6c-.2-1 .4-2 1.4-2.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5.5" width="17" height="13" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4.5 7 7.5 5.5L19.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function contactLink(href, label, icon, newTab = false) {
  const link = document.createElement("a");
  link.className = "contact-link";
  link.href = href;
  link.setAttribute("aria-label", label);
  link.title = label;
  link.innerHTML = CONTACT_ICONS[icon];
  if (newTab) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
  return link;
}

function representativeLocation(r) { return r.comunas.length === 1 ? r.comunas[0] : ""; }
function hasActiveContext() { return Boolean(els.q.value.trim() || els.corte.value || els.region.value || els.comuna.value || els.contacto.value); }
function updateSortLabel() { els.sort.options[0].textContent = els.q.value.trim() ? "Coincidencia textual" : "Orden predeterminado"; }

function details(r) {
  const d = document.createElement("details");
  d.className = "more";
  const s = document.createElement("summary");
  s.textContent = "Cobertura y fuente";
  d.appendChild(s);

  const box = document.createElement("div");
  if (r.comunas.length) box.appendChild(p("Comunas: ", r.comunas.join(", ")));
  if (r.tribunales.length) box.appendChild(p("Tribunales relacionados: ", r.tribunales.join(", ")));
  if (r.fuente) box.appendChild(p("Fuente: ", [r.fuente, r.fecha_fuente].filter(Boolean).join(" · ")));
  d.appendChild(box);
  return d;
}

function p(label, text) {
  const el = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label;
  el.append(strong, document.createTextNode(text));
  return el;
}

function saveUrl() {
  const u = new URL(location.href);
  u.search = "";
  if (els.q.value.trim()) u.searchParams.set("q", els.q.value.trim());
  if (els.corte.value) u.searchParams.set("corte", els.corte.value);
  if (els.region.value) u.searchParams.set("region", els.region.value);
  if (els.comuna.value) u.searchParams.set("comuna", els.comuna.value);
  if (els.contacto.value) u.searchParams.set("contacto", els.contacto.value);
  history.replaceState(null, "", u.pathname + u.search + u.hash);
}

function restoreUrl() {
  const u = new URL(location.href);
  els.q.value = u.searchParams.get("q") || "";
  els.clear.hidden = !els.q.value;
  setSelect(els.corte, u.searchParams.get("corte"));
  setSelect(els.region, u.searchParams.get("region"));
  populateComunaOptions();
  setSelect(els.comuna, u.searchParams.get("comuna"));
  setSelect(els.contacto, u.searchParams.get("contacto"));
}

function setSelect(el, value) {
  if (value && [...el.options].some(o => o.value === value)) el.value = value;
}

function splitPhones(v) { return String(v || "").split(/\s*[|;/]\s*/).map(x => x.trim()).filter(Boolean); }
function digits(v) { return String(v || "").replace(/\D+/g,""); }
function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function unique(v) { return [...new Set(v)].sort(compareGeographic); }
function compareGeographic(a,b) { return String(a).localeCompare(String(b),"es",{sensitivity:"base"}); }
function canonicalRegion(value) { const key = norm(value); return REGION_ORDER.find(region => norm(region) === key) || value; }
function regionRank(value) { const index = REGION_ORDER.findIndex(region => norm(region) === norm(value)); return index < 0 ? REGION_ORDER.length : index; }
function sortRegions(values) { return [...(values || [])].sort((a,b) => regionRank(a) - regionRank(b) || compareGeographic(a,b)); }
function courtGridKey(value) { const suffix = norm(value).replace(/^corte de apelaciones de\s+/, ""); return COURT_GRID_ALIASES.get(suffix) || suffix; }
function courtGridRank(value) { const index = COURT_GRID_ORDER.indexOf(courtGridKey(value)); return index < 0 ? COURT_GRID_ORDER.length : index; }
function courtGridLabel(value) { const suffix = String(value).replace(/^Corte de Apelaciones de\s+/i, ""); return suffix === "la Serena" ? "La Serena" : suffix === "Coihaique" ? "Coyhaique" : suffix; }
function compareCourts(a,b) { const regionA = corteInfo.find(c => c.nombre === a)?.regiones_comunas?.map(name => comunaInfo.get(norm(name))?.region).find(Boolean); const regionB = corteInfo.find(c => c.nombre === b)?.regiones_comunas?.map(name => comunaInfo.get(norm(name))?.region).find(Boolean); return regionRank(regionA) - regionRank(regionB) || compareGeographic(a,b); }
function canonicalUrl(r) { return `https://receptores.vukusic.cl/receptores/${String(r.id || "").replace(/^rec-\d+-/i, "")}.html`; }
function vcardEscape(value) { return String(value || "").replace(/([\\,;])/g, "\\$1").replace(/\r?\n|\r/g, "\\n"); }
function downloadVCard(r) {
  const phone = r.phones.find(p => p.href)?.href.replace(/^tel:/i, "") || "";
  const note = [r.corte && `Corte: ${r.corte}`, r.comunas.length && `Comunas: ${r.comunas.join(", ")}`].filter(Boolean).join("; ");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", r.contactName && `FN:${vcardEscape(r.contactName)}`, `N:${vcardEscape(r.contactSurnames)};${vcardEscape(r.contactGivenNames)};;;`, phone && `TEL;TYPE=CELL:${vcardEscape(phone)}`, r.emails[0] && `EMAIL:${vcardEscape(r.emails[0])}`, "ORG:Receptor Judicial", note && `NOTE:${vcardEscape(note)}`, `URL:${vcardEscape(canonicalUrl(r))}`, "END:VCARD"].filter(Boolean);
  const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/vcard;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = objectUrl; link.download = `${String(r.id || "receptor").replace(/^rec-\d+-/i, "")}.vcf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
}
const CONTACT_PARTICLES = new Set(["de", "del", "la", "las", "los", "van", "von"]);
const CONTACT_SURNAME_PARTICLES = new Set([...CONTACT_PARTICLES, "san", "santa"]);
function contactNatural(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).map((word, index) => CONTACT_PARTICLES.has(word.toLowerCase()) && index > 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" "); }
function consumeContactSurname(tokens, start) { const first = (tokens[start] || "").toLowerCase(); if (first === "de" && ["la", "las", "los"].includes((tokens[start + 1] || "").toLowerCase())) return [tokens.slice(start, start + 3), start + 3]; if (CONTACT_SURNAME_PARTICLES.has(first)) return [tokens.slice(start, start + 2), start + 2]; return [[tokens[start]], start + 1]; }
function inferContactName(source) { const tokens = String(source || "").trim().split(/\s+/).filter(Boolean); if (tokens.length < 3) { const value = contactNatural(source); return { nombres_contacto:value, apellidos_contacto:"", nombre_contacto:value }; } const [first, firstEnd] = consumeContactSurname(tokens, 0); const [second, secondEnd] = consumeContactSurname(tokens, firstEnd); const names = tokens.slice(secondEnd); if (!names.length) { const value = contactNatural(source); return { nombres_contacto:value, apellidos_contacto:"", nombre_contacto:value }; } const surnames = contactNatural([...first, ...second].join(" ")); const given = contactNatural(names.join(" ")); return { nombres_contacto:given, apellidos_contacto:surnames, nombre_contacto:`${given} ${surnames}` }; }
function contactSlug(id) { return String(id || "").replace(/^rec-\d+-/i, ""); }
function parseContactAudit(csv) { const rows = [], current = []; let field = "", quoted = false; for (let i = 0; i < csv.length; i++) { const char = csv[i], next = csv[i + 1]; if (char === '"' && quoted && next === '"') { field += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { current.push(field); field = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") i++; current.push(field); rows.push(current.splice(0)); field = ""; } else field += char; } if (field || current.length) { current.push(field); rows.push(current); } const header = rows.shift() || [], index = name => header.indexOf(name); return new Map(rows.filter(row => row[index("slug")]).map(row => [row[index("slug")], { nombre_override:row[index("nombre_override")] || "", nombres_override:row[index("nombres_override")] || "", apellidos_override:row[index("apellidos_override")] || "" }])); }
async function copyLink(button, url) { const original = "Copiar enlace"; button.disabled = true; try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url); else { const input = document.createElement("textarea"); input.value = url; input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select(); if (!document.execCommand("copy")) throw new Error("copy_failed"); input.remove(); } button.textContent = "Enlace copiado"; } catch (_) { button.textContent = "No se pudo copiar"; } setTimeout(() => { button.textContent = original; button.disabled = false; }, 1600); }
function byName(a,b) { return String(a.displayName || a.nombre || "").localeCompare(String(b.displayName || b.nombre || ""),"es",{sensitivity:"base"}); }
function norm(v="") { return String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9ñ]+/g," ").replace(/\s+/g," ").trim(); }
function fmt(v) { return new Intl.NumberFormat("es-CL").format(v); }
function formatDate(v) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(v);
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  return new Intl.DateTimeFormat("es-CL",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(d);
}
function formatNational(d) {
  if (d.length === 9 && d.startsWith("9")) return `+56 9 ${d.slice(1,5)} ${d.slice(5)}`;
  if (d.length === 9) return `+56 ${d.slice(0,1)} ${d.slice(1,5)} ${d.slice(5)}`;
  return `+56 ${d}`;
}
})();
