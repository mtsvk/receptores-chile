(() => {
  "use strict";

  const SITE_LAST_UPDATED = "13 de mayo de 2026";
  const CONTACT_EMAIL = "mtsvw1@gmail.com";
  const CONTACT_WHATSAPP_NUMBER = "56998895099";
  const MAX_INITIAL_RESULTS = 24;
  const MAX_SEARCH_RESULTS = 120;
  const RESULT_AD_EVERY = 8;
  const MAX_RESULT_ADS = 2;

  const DATA_SOURCES = [
    { type: "json", url: "data/receptores_poder_judicial.json" },
    { type: "json", url: "receptores_poder_judicial.json" },
    { type: "csv", url: "data/receptores_poder_judicial.csv" },
    { type: "csv", url: "receptores_poder_judicial.csv" },
    { type: "json", url: "https://receptoreschile.neocities.org/receptores_poder_judicial.json" },
    { type: "csv", url: "https://receptoreschile.neocities.org/receptores_poder_judicial.csv" }
  ];

  const FALLBACK_ADS = [
    {
        "id": "pan-caliente",
        "label": "Auspicio raro",
        "title": "Este sitio te lo trae pan recién caliente",
        "text": "Crujiente, útil y sin login.",
        "href": "#contacto",
        "image": "assets/ads/pan-caliente-960.jpg",
        "imageMobile": "assets/ads/pan-caliente-640.jpg"
    },
    {
        "id": "cafe-pasillo",
        "label": "Traído a usted por",
        "title": "Este buscador funciona con café de pasillo",
        "text": "Y una cantidad razonable de desesperación.",
        "href": "#contacto",
        "image": "assets/ads/cafe-pasillo-960.jpg",
        "imageMobile": "assets/ads/cafe-pasillo-640.jpg"
    },
    {
        "id": "completo-italiano",
        "label": "Pausa comercial humilde",
        "title": "Completo italiano, diligencia completa",
        "text": "No garantizamos mayo sin palta.",
        "href": "#contacto",
        "image": "assets/ads/completo-italiano-960.jpg",
        "imageMobile": "assets/ads/completo-italiano-640.jpg"
    },
    {
        "id": "archivador-sentimental",
        "label": "Auspicio raro",
        "title": "Archivador emocionalmente estable",
        "text": "Ha visto cosas.",
        "href": "#contacto",
        "image": "assets/ads/archivador-sentimental-960.jpg",
        "imageMobile": "assets/ads/archivador-sentimental-640.jpg"
    },
    {
        "id": "timbre-mistico",
        "label": "Pausa procesal",
        "title": "Auspicia el timbre que todo lo certifica",
        "text": "Pum. Constancia.",
        "href": "#contacto",
        "image": "assets/ads/timbre-mistico-960.jpg",
        "imageMobile": "assets/ads/timbre-mistico-640.jpg"
    },
    {
        "id": "plantita",
        "label": "Este espacio existe gracias a",
        "title": "La plantita que sobrevivió al cierre de mes",
        "text": "Más resiliente que el sistema.",
        "href": "#contacto",
        "image": "assets/ads/plantita-960.jpg",
        "imageMobile": "assets/ads/plantita-640.jpg"
    }
];

  const state = {
    all: [],
    filtered: [],
    ads: FALLBACK_ADS,
    adOffset: getSessionAdOffset(),
    dataSource: "",
    lastQuery: ""
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindElements();
    hydrateStaticText();
    bindEvents();
    await loadAds();
    renderTopAd();
    await loadData();
  }

  function bindElements() {
    els.searchInput = document.getElementById("searchInput");
    els.clearSearch = document.getElementById("clearSearch");
    els.filterEmail = document.getElementById("filterEmail");
    els.filterPhone = document.getElementById("filterPhone");
    els.filterSantiago = document.getElementById("filterSantiago");
    els.statusText = document.getElementById("statusText");
    els.copyVisible = document.getElementById("copyVisible");
    els.randomAdButton = document.getElementById("randomAdButton");
    els.results = document.getElementById("results");
    els.adSlotTop = document.getElementById("adSlotTop");
    els.adTemplate = document.getElementById("adTemplate");
    els.footerUpdatedAt = document.getElementById("footerUpdatedAt");
    els.updatedPill = document.getElementById("updatedPill");
    els.heroReportLink = document.getElementById("heroReportLink");
  }

  function hydrateStaticText() {
    if (els.footerUpdatedAt) els.footerUpdatedAt.textContent = SITE_LAST_UPDATED;
    if (els.updatedPill) els.updatedPill.textContent = `Datos actualizados al ${SITE_LAST_UPDATED}`;
    const mailto = buildMailto("Reporte Receptores Chile", "Hola, encontré un dato raro en Receptores Chile:%0D%0A%0D%0A");
    if (els.heroReportLink) els.heroReportLink.href = mailto;
  }

  function bindEvents() {
    const rerender = debounce(() => applyFilters(), 80);
    els.searchInput.addEventListener("input", rerender);
    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      els.searchInput.focus();
      applyFilters();
    });
    els.filterEmail.addEventListener("change", applyFilters);
    els.filterPhone.addEventListener("change", applyFilters);
    els.filterSantiago.addEventListener("change", applyFilters);
    els.copyVisible.addEventListener("click", copyVisibleResults);
    els.randomAdButton.addEventListener("click", () => {
      state.adOffset = (state.adOffset + 1) % state.ads.length;
      sessionStorage.setItem("receptoresChileAdOffset", String(state.adOffset));
      renderTopAd();
      renderResults(state.filtered, { preserveStatus: true });
    });
  }

  async function loadAds() {
    try {
      const response = await fetch(withCacheBust("data/ads.json"));
      if (!response.ok) throw new Error("No ads.json");
      const ads = await response.json();
      if (Array.isArray(ads) && ads.length) state.ads = ads;
    } catch (_) {
      state.ads = FALLBACK_ADS;
    }
  }

  async function loadData() {
    setStatus("Cargando datos…");
    renderEmpty("Estoy abriendo la planilla. Un segundo procesal.");

    const errors = [];
    for (const source of DATA_SOURCES) {
      try {
        const rows = await fetchSource(source);
        const cleaned = rows.map(normalizeRow).filter(row => row.Nombre || row.Corte || row.Tribunal);
        if (!cleaned.length) throw new Error("Fuente vacía");
        state.all = cleaned.sort(sortByName);
        state.dataSource = source.url;
        applyFilters();
        return;
      } catch (error) {
        errors.push(`${source.url}: ${error.message}`);
      }
    }

    console.error("No se pudieron cargar fuentes", errors);
    setStatus("No se pudieron cargar los datos.");
    renderError("No logré cargar el archivo de receptores. Revisa que exista data/receptores_poder_judicial.json o data/receptores_poder_judicial.csv.");
  }

  async function fetchSource(source) {
    const response = await fetch(withCacheBust(source.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();

    if (source.type === "json") {
      const safeText = text.replace(/\bNaN\b/g, "null");
      const data = JSON.parse(safeText);
      if (!Array.isArray(data)) throw new Error("JSON no es una lista");
      return data;
    }

    return parseCSV(text);
  }

  function normalizeRow(raw) {
    const row = {
      Nombre: cleanValue(raw.Nombre),
      Corte: cleanValue(raw.Corte),
      Tribunal: cleanValue(raw.Tribunal),
      Correo_Principal: cleanValue(raw.Correo_Principal || raw.Correo || raw.Email),
      Correo_Alternativo: cleanValue(raw.Correo_Alternativo),
      Telefono_Celular: cleanValue(raw.Telefono_Celular || raw.Celular || raw.Teléfono_Celular),
      Telefono_Fijo: cleanValue(raw.Telefono_Fijo || raw.Fijo || raw.Teléfono_Fijo),
      Recomendaciones: cleanValue(raw.Recomendaciones)
    };

    row._search = normalizeText([
      row.Nombre,
      row.Corte,
      row.Tribunal,
      row.Correo_Principal,
      row.Correo_Alternativo,
      row.Telefono_Celular,
      row.Telefono_Fijo
    ].join(" "));

    return row;
  }

  function applyFilters() {
    const query = els.searchInput.value.trim();
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    const onlyEmail = els.filterEmail.checked;
    const onlyPhone = els.filterPhone.checked;
    const onlySantiago = els.filterSantiago.checked;

    state.lastQuery = query;

    let results = state.all.filter(row => {
      if (onlyEmail && !hasEmail(row)) return false;
      if (onlyPhone && !hasPhone(row)) return false;
      if (onlySantiago && !isSantiagoOrSanMiguel(row)) return false;
      if (!tokens.length) return true;
      return tokens.every(token => row._search.includes(token));
    });

    results = results.sort((a, b) => scoreRow(b, tokens) - scoreRow(a, tokens) || sortByName(a, b));
    state.filtered = results;
    renderResults(results);
  }

  function renderResults(results, options = {}) {
    els.results.innerHTML = "";

    const hasQuery = Boolean(state.lastQuery.trim());
    const limit = hasQuery ? MAX_SEARCH_RESULTS : MAX_INITIAL_RESULTS;
    const visible = results.slice(0, limit);

    if (!options.preserveStatus) {
      const base = `${results.length.toLocaleString("es-CL")} resultado${results.length === 1 ? "" : "s"}`;
      const suffix = visible.length < results.length ? ` · mostrando ${visible.length.toLocaleString("es-CL")}` : "";
      setStatus(`${base}${suffix}`);
    }

    if (!results.length) {
      renderEmpty("No encontré nada con esos filtros. Prueba con apellido, Corte o comuna.");
      return;
    }

    let adsInserted = 0;
    visible.forEach((row, index) => {
      els.results.appendChild(createResultCard(row));
      const shouldInsertAd = (index + 1) % RESULT_AD_EVERY === 0 && index + 1 < visible.length && adsInserted < MAX_RESULT_ADS;
      if (shouldInsertAd) {
        els.results.appendChild(createAdCard(pickAd(index + 1 + adsInserted)));
        adsInserted += 1;
      }
    });

    if (visible.length < results.length) {
      const note = document.createElement("div");
      note.className = "empty-state";
      note.textContent = `Hay más resultados (${results.length.toLocaleString("es-CL")}). Escribe algo más específico para afinar la búsqueda.`;
      els.results.appendChild(note);
    }
  }

  function createResultCard(row) {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.textContent = row.Nombre || "Receptor sin nombre informado";
    card.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "badge-row";
    badges.appendChild(createBadge(hasEmail(row) ? "Con correo" : "Sin correo", hasEmail(row) ? "ok" : "muted"));
    badges.appendChild(createBadge(hasPhone(row) ? "Con teléfono" : "Sin teléfono", hasPhone(row) ? "ok" : "muted"));
    if (row.Recomendaciones) badges.appendChild(createBadge(`Recomendaciones: ${row.Recomendaciones}`, "muted"));
    card.appendChild(badges);

    const meta = document.createElement("div");
    meta.className = "meta-grid";
    addField(meta, "Corte", row.Corte || "No informada");
    addField(meta, "Tribunal", row.Tribunal || "No informado");
    addField(meta, "Correo", createEmailFragment(row), true);
    addField(meta, "Teléfono", createPhoneFragment(row), true);
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.appendChild(createButton("Copiar", () => copyRow(row)));
    actions.appendChild(createLinkButton("Recomendar", buildWhatsAppHref(`Quiero recomendar a ${row.Nombre || "este receptor"}.`)));
    actions.appendChild(createLinkButton("Reportar dato", buildMailto(
      `Dato raro: ${row.Nombre || "receptor"}`,
      encodeURIComponent(`Hola, encontré un dato raro en Receptores Chile.\n\nNombre: ${row.Nombre}\nCorte: ${row.Corte}\nTribunal: ${row.Tribunal}\n\nDetalle:`)
    ), "report"));
    card.appendChild(actions);

    return card;
  }

  function addField(parent, label, value, isNode = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";

    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "field-value";
    if (isNode) valueEl.appendChild(value);
    else valueEl.textContent = value;

    wrapper.append(labelEl, valueEl);
    parent.appendChild(wrapper);
  }

  function createEmailFragment(row) {
    const fragment = document.createDocumentFragment();
    const emails = [row.Correo_Principal, row.Correo_Alternativo].filter(Boolean);
    if (!emails.length) {
      fragment.append("No informado");
      return fragment;
    }

    emails.forEach((email, index) => {
      if (index) fragment.append(" · ");
      const link = document.createElement("a");
      link.href = `mailto:${email}`;
      link.textContent = email;
      fragment.appendChild(link);
    });
    return fragment;
  }

  function createPhoneFragment(row) {
    const fragment = document.createDocumentFragment();
    const phones = [row.Telefono_Celular, row.Telefono_Fijo].filter(Boolean).map(formatPhone);
    if (!phones.length) {
      fragment.append("No informado");
      return fragment;
    }

    phones.forEach((phone, index) => {
      if (index) fragment.append(" · ");
      const hrefNumber = phone.replace(/\D/g, "");
      const link = document.createElement("a");
      link.href = `tel:${hrefNumber.startsWith("56") ? "+" : "+56"}${hrefNumber}`;
      link.textContent = phone;
      fragment.appendChild(link);
    });
    return fragment;
  }

  function createBadge(text, variant = "") {
    const badge = document.createElement("span");
    badge.className = `badge ${variant}`.trim();
    badge.textContent = text;
    return badge;
  }

  function createButton(text, onClick) {
    const button = document.createElement("button");
    button.className = "card-button";
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function createLinkButton(text, href, extraClass = "") {
    const link = document.createElement("a");
    link.className = `card-button ${extraClass}`.trim();
    link.href = href;
    link.target = href.startsWith("http") ? "_blank" : "";
    link.rel = href.startsWith("http") ? "noopener noreferrer" : "";
    link.textContent = text;
    return link;
  }

  function renderTopAd() {
    els.adSlotTop.innerHTML = "";
    els.adSlotTop.appendChild(createAdCard(pickAd(0)));
  }

  function createAdCard(ad) {
    const node = els.adTemplate.content.firstElementChild.cloneNode(true);
    node.href = ad.href || "#contacto";
    node.setAttribute("aria-label", `${ad.label || "Auspicio"}: ${ad.title || ""}`);

    const source = node.querySelector(".ad-source-mobile");
    const img = node.querySelector(".ad-image");
    const label = node.querySelector(".ad-label");
    const title = node.querySelector(".ad-title");
    const text = node.querySelector(".ad-text");

    source.srcset = ad.imageMobile || ad.image || "";
    img.src = ad.image || ad.imageMobile || "";
    img.alt = "";
    img.addEventListener("error", () => node.classList.add("ad-card--fallback"), { once: true });

    label.textContent = ad.label || "Auspicio raro";
    title.textContent = ad.title || "Este espacio está disponible";
    text.textContent = ad.text || "Humilde, útil y con cariño.";

    return node;
  }

  function pickAd(index = 0) {
    if (!state.ads.length) return FALLBACK_ADS[0];
    return state.ads[(state.adOffset + index) % state.ads.length];
  }

  function renderEmpty(message) {
    els.results.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    els.results.appendChild(empty);
  }

  function renderError(message) {
    els.results.innerHTML = "";
    const error = document.createElement("div");
    error.className = "error-state";
    error.textContent = message;
    els.results.appendChild(error);
  }

  async function copyVisibleResults() {
    if (!state.filtered.length) {
      alert("No hay resultados para copiar.");
      return;
    }

    const hasQuery = Boolean(state.lastQuery.trim());
    const limit = hasQuery ? MAX_SEARCH_RESULTS : MAX_INITIAL_RESULTS;
    const text = state.filtered.slice(0, limit).map(formatRowForCopy).join("\n\n---\n\n");
    await copyText(text, "Resultados visibles copiados.");
  }

  async function copyRow(row) {
    await copyText(formatRowForCopy(row), "Receptor copiado.");
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      alert(okMessage);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      alert(okMessage);
    }
  }

  function formatRowForCopy(row) {
    return [
      `Nombre: ${row.Nombre || ""}`,
      `Corte: ${row.Corte || ""}`,
      `Tribunal: ${row.Tribunal || ""}`,
      `Correo principal: ${row.Correo_Principal || "No informado"}`,
      `Correo alternativo: ${row.Correo_Alternativo || "No informado"}`,
      `Teléfono celular: ${row.Telefono_Celular || "No informado"}`,
      `Teléfono fijo: ${row.Telefono_Fijo || "No informado"}`
    ].join("\n");
  }

  function scoreRow(row, tokens) {
    if (!tokens.length) return 0;
    const name = normalizeText(row.Nombre || "");
    const court = normalizeText(row.Corte || "");
    const tribunal = normalizeText(row.Tribunal || "");
    let score = 0;
    for (const token of tokens) {
      if (name.startsWith(token)) score += 40;
      if (name.includes(token)) score += 18;
      if (court.includes(token)) score += 10;
      if (tribunal.includes(token)) score += 8;
      if (row._search.includes(token)) score += 2;
    }
    return score;
  }

  function sortByName(a, b) {
    return String(a.Nombre || "").localeCompare(String(b.Nombre || ""), "es", { sensitivity: "base" });
  }

  function hasEmail(row) {
    return Boolean(row.Correo_Principal || row.Correo_Alternativo);
  }

  function hasPhone(row) {
    return Boolean(row.Telefono_Celular || row.Telefono_Fijo);
  }

  function isSantiagoOrSanMiguel(row) {
    const haystack = normalizeText(`${row.Corte} ${row.Tribunal}`);
    return haystack.includes("santiago") || haystack.includes("san miguel");
  }

  function cleanValue(value) {
    if (value === null || value === undefined) return "";
    const string = String(value).trim();
    if (!string || /^(nan|null|undefined)$/i.test(string)) return "";
    return string;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9ñ\s@.+-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatPhone(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");
    if (!digits) return raw;
    if (digits.length === 8) return `+56 2 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    if (digits.length === 9) return `+56 ${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    if (digits.length === 11 && digits.startsWith("56")) return `+${digits.slice(0, 2)} ${digits.slice(2, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
    return raw;
  }

  function buildWhatsAppHref(message) {
    return `https://wa.me/${CONTACT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }

  function buildMailto(subject, body = "") {
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${body}` : ""}`;
  }

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function getSessionAdOffset() {
    const current = Number(sessionStorage.getItem("receptoresChileAdOffset"));
    if (Number.isFinite(current) && current >= 0) return current;
    const next = Math.floor(Math.random() * FALLBACK_ADS.length);
    sessionStorage.setItem("receptoresChileAdOffset", String(next));
    return next;
  }

  function withCacheBust(url) {
    if (url.startsWith("http")) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=2026-05-13`;
  }

  function debounce(fn, delay = 120) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some(value => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    row.push(cell);
    if (row.some(value => value.trim() !== "")) rows.push(row);
    if (!rows.length) return [];

    const headers = rows.shift().map(header => header.trim());
    return rows.map(values => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = values[index] === undefined ? "" : values[index];
      });
      return object;
    });
  }
})();
