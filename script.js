(() => {
  "use strict";
  const DATA_URL = "data/receptores.json";
  const META_URL = "data/meta.json";
  const PAGE_SIZE = 75;
  const ESTIMATED_FLAGS = new Set(["territory_inferred_from_court_not_specific_tribunal","court_level_assignment"]);
  const RESOLVED_FLAG = "RESUELTO_POR_COINCIDENCIA_8D_9D";

  const state={rows:[],filtered:[],meta:null,visibleCount:PAGE_SIZE};
  const els={};
  document.addEventListener("DOMContentLoaded",init);

  async function init(){
    bindElements(); bindEvents();
    try{
      const [rr,mr]=await Promise.all([fetch(DATA_URL),fetch(META_URL)]);
      if(!rr.ok||!mr.ok) throw new Error("Dataset local no disponible");
      const [rows,meta]=await Promise.all([rr.json(),mr.json()]);
      if(!Array.isArray(rows)) throw new Error("Dataset inválido");
      load(rows,meta);
    }catch(e){
      console.error(e);
      els.resultStatus.textContent="No fue posible cargar los datos.";
      els.emptyState.hidden=false;
      els.emptyState.querySelector("strong").textContent="Error al cargar datos";
      els.emptyState.querySelector("p").textContent="Verifica que la carpeta data/ esté publicada junto al sitio.";
    }
  }
  function load(rows,meta){
    state.rows=rows.map(prepareRow).sort(compareRows); state.meta=meta;
    populateFilters(); renderMeta(); restoreStateFromUrl(); applyFilters({updateUrl:false}); revealHashTarget();
  }
  function bindElements(){["searchInput","clearSearch","filterCorte","filterComuna","filterContacto","resetFilters","resultStatus","resultsBody","tableWrap","emptyState","coverageNotice","loadMoreWrap","loadMore","datasetLine","footerMeta","sourceText"].forEach(id=>els[id]=document.getElementById(id));}
  function bindEvents(){
    const delayed=debounce(()=>{state.visibleCount=PAGE_SIZE;applyFilters()},80);
    els.searchInput.addEventListener("input",()=>{els.clearSearch.hidden=!els.searchInput.value;delayed()});
    els.clearSearch.addEventListener("click",()=>{els.searchInput.value="";els.clearSearch.hidden=true;state.visibleCount=PAGE_SIZE;applyFilters();els.searchInput.focus()});
    [els.filterCorte,els.filterComuna,els.filterContacto].forEach(el=>el.addEventListener("change",()=>{state.visibleCount=PAGE_SIZE;applyFilters()}));
    els.resetFilters.addEventListener("click",()=>{els.searchInput.value="";els.clearSearch.hidden=true;els.filterCorte.value="";els.filterComuna.value="";els.filterContacto.value="";state.visibleCount=PAGE_SIZE;applyFilters();els.searchInput.focus()});
    els.loadMore.addEventListener("click",()=>{state.visibleCount+=PAGE_SIZE;renderResults()});
    window.addEventListener("hashchange",revealHashTarget);
  }
  function prepareRow(raw){
    const comunas=Array.isArray(raw.comunas_cubiertas)?raw.comunas_cubiertas.filter(Boolean):[];
    const tribunales=Array.isArray(raw.tribunales_relacionados)?raw.tribunales_relacionados.filter(Boolean):[];
    const emails=Array.isArray(raw.emails)?raw.emails.filter(Boolean):(raw.email?[raw.email]:[]);
    const flags=Array.isArray(raw.flags_calidad)?raw.flags_calidad.filter(Boolean):[];
    const telLinks=Array.isArray(raw.tel_links_seguros)?raw.tel_links_seguros.filter(isValidTel):[];
    const waLinks=Array.isArray(raw.whatsapp_links_seguros)?raw.whatsapp_links_seguros.filter(isValidWa):[];

    // Regla editorial del sitio: todo teléfono de 8 dígitos se interpreta
    // como móvil chileno y se completa como +56 9 XXXXXXXX.
    const rawPhones=[...splitPhones(raw.telefono_celular_display||raw.telefono||""),...splitPhones(raw.telefono_fijo_display||raw.telefono_fijo||"")];
    rawPhones.forEach(value=>{
      const d=digits(value);
      if(d.length!==8)return;
      const national=`9${d}`;
      telLinks.push(`tel:+56${national}`);
      waLinks.push(`https://wa.me/56${national}`);
    });

    const search=[raw.nombre,raw.corte,raw.territorio,raw.tribunal_fuente,...comunas,...tribunales,...emails,raw.telefono,raw.telefono_fijo,raw.telefono_normalizado].filter(Boolean).join(" ");
    return {...raw,comunas_cubiertas:comunas,tribunales_relacionados:tribunales,emails,flags_calidad:flags,tel_links_seguros:[...new Set(telLinks)],whatsapp_links_seguros:[...new Set(waLinks)],_search:normalizeText(search),_corte:normalizeText(raw.corte||""),_comunas:new Set(comunas.map(normalizeText)),_coverageEstimated:flags.some(f=>ESTIMATED_FLAGS.has(f)),_resolved8d9d:flags.includes(RESOLVED_FLAG)};
  }
  function populateFilters(){
    appendOptions(els.filterCorte,uniqueSorted(state.rows.map(r=>r.corte).filter(Boolean)),v=>v.replace(/^Corte de Apelaciones de\s+/i,""));
    appendOptions(els.filterComuna,uniqueSorted(state.rows.flatMap(r=>r.comunas_cubiertas)));
  }
  function appendOptions(select,values,format=v=>v){select.querySelectorAll("option:not(:first-child)").forEach(o=>o.remove());const f=document.createDocumentFragment();values.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=format(v);f.appendChild(o)});select.appendChild(f)}
  function renderMeta(){
    const total=state.meta?.conteos?.receptores||state.rows.length; const generated=formatDate(state.meta?.generado);
    els.datasetLine.textContent=`${formatNumber(total)} receptores · fuente Poder Judicial · actualización ${generated||"no informada"}`;
    els.footerMeta.textContent=generated?`Dataset actualizado: ${generated}.`:"";
  }

  function restoreStateFromUrl(){
    const params=new URLSearchParams(window.location.search);
    const q=params.get("q")||"",corte=params.get("corte")||"",comuna=params.get("comuna")||"",contacto=params.get("contacto")||"";
    els.searchInput.value=q; els.clearSearch.hidden=!q;
    setIfOptionExists(els.filterCorte,corte); setIfOptionExists(els.filterComuna,comuna); setIfOptionExists(els.filterContacto,contacto);
  }
  function setIfOptionExists(select,value){if(!value)return;if([...select.options].some(o=>o.value===value))select.value=value}
  function updateUrlState(){
    const params=new URLSearchParams(),q=els.searchInput.value.trim();
    if(q)params.set("q",q); if(els.filterCorte.value)params.set("corte",els.filterCorte.value); if(els.filterComuna.value)params.set("comuna",els.filterComuna.value); if(els.filterContacto.value)params.set("contacto",els.filterContacto.value);
    const query=params.toString(); history.replaceState(null,"",`${location.pathname}${query?`?${query}`:""}${location.hash}`);
  }
  function applyFilters(){
    const tokens=normalizeText(els.searchInput.value).split(/\s+/).filter(Boolean),corte=normalizeText(els.filterCorte.value),comuna=normalizeText(els.filterComuna.value),contacto=els.filterContacto.value;
    state.filtered=state.rows.filter(r=>{if(corte&&r._corte!==corte)return false;if(comuna&&!r._comunas.has(comuna))return false;if(contacto==="email"&&!r.emails.length)return false;if(contacto==="phone"&&!hasPhone(r))return false;if(contacto==="whatsapp"&&!r.whatsapp_links_seguros.length)return false;if(tokens.length&&!tokens.every(t=>r._search.includes(t)))return false;return true}).sort(compareRows);updateUrlState();renderResults();
  }
  function renderResults(){
    const total=state.filtered.length,visible=state.filtered.slice(0,state.visibleCount);els.resultsBody.replaceChildren(...visible.map(createRow));els.tableWrap.hidden=total===0;els.emptyState.hidden=total!==0;els.loadMoreWrap.hidden=visible.length>=total;const estimated=state.filtered.some(r=>r._coverageEstimated);els.coverageNotice.hidden=!(estimated&&Boolean(els.filterComuna.value));
    if(!total){els.resultStatus.textContent="0 receptores";return}els.resultStatus.textContent=visible.length<total?`${formatNumber(total)} receptores · mostrando ${formatNumber(visible.length)}`:`${formatNumber(total)} receptor${total===1?"":"es"}`;if(visible.length<total)els.loadMore.textContent=`Mostrar ${formatNumber(Math.min(PAGE_SIZE,total-visible.length))} más`;
  }
  function createRow(row){
    const tr=document.createElement("tr");if(row.id)tr.id=row.id;
    const c1=document.createElement("td"),name=document.createElement("p");name.className="receiver-name";name.textContent=row.nombre||"Sin nombre";c1.append(name,createDetails(row));
    const c2=document.createElement("td"),primary=document.createElement("p");primary.className="cell-primary";primary.textContent=row.tribunal_fuente||row.territorio||row.corte||"No informado";c2.appendChild(primary);if(row.corte&&row.corte!==row.tribunal_fuente){const p=document.createElement("p");p.className="cell-secondary";p.textContent=row.corte;c2.appendChild(p)}
    const c3=document.createElement("td");c3.appendChild(createContactBlock(row));tr.append(c1,c2,c3);return tr;
  }
  function createContactBlock(row){
    const w=document.createElement("div");w.className="contact-list";
    row.emails.slice(0,2).forEach(email=>{const a=document.createElement("a");a.className="contact-email";a.href=`mailto:${email}`;a.textContent=email;w.appendChild(a)});
    buildPhoneLines(row).forEach(n=>w.appendChild(n));
    if(!row.emails.length&&!hasPhone(row)){const s=document.createElement("span");s.className="cell-secondary";s.textContent="Sin contacto informado";w.appendChild(s)}
    const actions=document.createElement("div");actions.className="contact-actions";const wa=row.whatsapp_links_seguros[0];if(wa){const a=document.createElement("a");a.href=wa;a.target="_blank";a.rel="noopener noreferrer";a.textContent="WhatsApp ↗";actions.appendChild(a)}if(row.id){const a=document.createElement("a");a.href=`#${encodeURIComponent(row.id)}`;a.textContent="Enlace";actions.appendChild(a)}if(actions.childNodes.length)w.appendChild(actions);return w;
  }
  function buildPhoneLines(row){
    const out=[],safe=row.tel_links_seguros||[];
    safe.forEach(link=>{const a=document.createElement("a");a.className="phone-link";a.href=link;a.textContent=formatTelLink(link);out.push(a)});
    if(row._resolved8d9d&&safe.length)return out;
    const raw=[...splitPhones(row.telefono_celular_display||row.telefono||""),...splitPhones(row.telefono_fijo_display||row.telefono_fijo||"")];const seen=new Set();
    raw.forEach(v=>{const d=digits(v);if(!d||seen.has(d))return;seen.add(d);if(safe.some(l=>matches(d,l)))return;const s=document.createElement("span");s.className="phone-raw";s.textContent=v;out.push(s)});return out;
  }
  function createDetails(row){
    const d=document.createElement("details");d.className="row-details";const s=document.createElement("summary");s.textContent="Cobertura y fuente";d.appendChild(s);const c=document.createElement("div");c.className="details-content";
    if(row.comunas_cubiertas.length)c.appendChild(detailP("Comunas: ",row.comunas_cubiertas.join(", ")));
    if(row.tribunales_relacionados.length)c.appendChild(detailP("Tribunales relacionados: ",row.tribunales_relacionados.join(", ")));
    if(row.fuente||row.fecha_fuente)c.appendChild(detailP("Fuente: ",[row.fuente,row.fecha_fuente].filter(Boolean).join(" · ")));
    d.appendChild(c);return d;
  }
  function detailP(label,text){const p=document.createElement("p"),b=document.createElement("strong");b.textContent=label;p.append(b,document.createTextNode(text));return p}

  function revealHashTarget(){
    const id=decodeURIComponent(location.hash.replace(/^#/,"")); if(!id||!state.filtered.length)return;
    const index=state.filtered.findIndex(r=>r.id===id); if(index<0)return;
    if(index>=state.visibleCount){state.visibleCount=Math.ceil((index+1)/PAGE_SIZE)*PAGE_SIZE;renderResults()}
    requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({block:"center"}));
  }
  function hasPhone(r){return Boolean((r.tel_links_seguros&&r.tel_links_seguros.length)||r.telefono_celular_display||r.telefono_fijo_display||r.telefono||r.telefono_fijo)}
  function splitPhones(v){return String(v||"").split(/\s*\|\s*/).map(x=>x.trim()).filter(Boolean)}
  function digits(v){return String(v||"").replace(/\D+/g,"")}
  function isValidTel(v){return /^tel:\+\d{10,15}$/.test(String(v||""))}
  function isValidWa(v){return /^https:\/\/wa\.me\/\d{10,15}$/.test(String(v||""))}
  function matches(raw,link){let ld=digits(link);return raw===ld||(ld.startsWith("56")&&ld.slice(2)===raw)||(raw.startsWith("56")&&raw.slice(2)===ld)}
  function formatTelLink(link){let d=digits(link);if(d.startsWith("56"))d=d.slice(2);if(d.length===9&&d.startsWith("9"))return `+56 9 ${d.slice(1,5)} ${d.slice(5)}`;if(d.length===9&&d.startsWith("2"))return `+56 2 ${d.slice(1,5)} ${d.slice(5)}`;if(d.length===9)return `+56 ${d.slice(0,1)} ${d.slice(1,5)} ${d.slice(5)}`;return link.replace(/^tel:/,"")}
  function compareRows(a,b){if(a._coverageEstimated!==b._coverageEstimated)return a._coverageEstimated?1:-1;return String(a.nombre||"").localeCompare(String(b.nombre||""),"es",{sensitivity:"base"})}
  function uniqueSorted(v){return [...new Set(v.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"es",{sensitivity:"base"}))}
  function normalizeText(v=""){return String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9ñ]+/g," ").replace(/\s+/g," ").trim()}
  function formatDate(v){if(!v)return"";const d=new Date(`${v}T12:00:00`);return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat("es-CL",{day:"numeric",month:"short",year:"numeric"}).format(d)}
  function formatNumber(v){return new Intl.NumberFormat("es-CL").format(v)}
  function debounce(fn,delay){let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),delay)}}
})();
