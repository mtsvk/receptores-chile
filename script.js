(() => {
  "use strict";

  const DATA_URL = "data/receptores.json";
  const META_URL = "data/meta.json";
  const PAGE_SIZE = 75;
  const ESTIMATED_FLAGS = new Set([
    "territory_inferred_from_court_not_specific_tribunal",
    "court_level_assignment"
  ]);
  const UNSAFE_WHATSAPP_FLAGS = new Set([
    "mobile_8_digit_prefixed_9_verify"
  ]);

  const state = {
    rows: [],
    filtered: [],
    meta: null,
    visibleCount: PAGE_SIZE
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindElements();
    bindEvents();

    try {
      const [rowsResponse, metaResponse] = await Promise.all([
        fetch(DATA_URL),
        fetch(META_URL)
      ]);

      if (!rowsResponse.ok) throw new Error(`No se pudo cargar ${DATA_URL} (HTTP ${rowsResponse.status})`);
      if (!metaResponse.ok) throw new Error(`No se pudo cargar ${META_URL} (HTTP ${metaResponse.status})`);

      const [rows, meta] = await Promise.all([
        rowsResponse.json(),
        metaResponse.json()
      ]);

      if (!Array.isArray(rows)) throw new Error("El dataset de receptores no es una lista.");

      state.rows = rows.map(prepareRow).sort(compareRows);
      state.meta = meta;

      populateFilters();
      renderMeta();
      restoreStateFromUrl();
      applyFilters({ updateUrl: false });
      revealHashTarget();
    } catch (error) {
      console.error(error);
      els.resultStatus.textContent = "No fue posible cargar los datos.";
      els.emptyState.hidden = false;
      els.emptyState.querySelector("strong").textContent = "Error al cargar datos";
      els.emptyState.querySelector("p").textContent = "Si estás probando la V2 localmente, abre el proyecto mediante un servidor web y conserva la carpeta data/.";
    }
  }

  function bindElements() {
    els.searchInput = document.getElementById("searchInput");
    els.clearSearch = document.getElementById("clearSearch");
    els.filterCorte = document.getElementById("filterCorte");
    els.filterComuna = document.getElementById("filterComuna");
    els.filterContacto = document.getElementById("filterContacto");
    els.resetFilters = document.getElementById("resetFilters");
    els.moreFilters = document.getElementById("moreFilters");
    els.resultStatus = document.getElementById("resultStatus");
    els.resultsBody = document.getElementById("resultsBody");
    els.tableWrap = document.getElementById("tableWrap");
    els.emptyState = document.getElementById("emptyState");
    els.coverageNotice = document.getElementById("coverageNotice");
    els.loadMoreWrap = document.getElementById("loadMoreWrap");
    els.loadMore = document.getElementById("loadMore");
    els.datasetLine = document.getElementById("datasetLine");
    els.footerMeta = document.getElementById("footerMeta");
    els.sourceText = document.getElementById("sourceText");
  }

  function bindEvents() {
    const delayedFilter = debounce(() => {
      state.visibleCount = PAGE_SIZE;
      applyFilters();
    }, 90);

    els.searchInput.addEventListener("input", () => {
      els.clearSearch.hidden = !els.searchInput.value;
      delayedFilter();
    });

    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      els.clearSearch.hidden = true;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
      els.searchInput.focus();
    });

    [els.filterCorte, els.filterComuna, els.filterContacto].forEach(select => {
      select.addEventListener("change", () => {
        state.visibleCount = PAGE_SIZE;
        applyFilters();
      });
    });

    els.resetFilters.addEventListener("click", () => {
      els.searchInput.value = "";
      els.clearSearch.hidden = true;
      els.filterCorte.value = "";
      els.filterComuna.value = "";
      els.filterContacto.value = "";
      els.moreFilters.open = false;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
      els.searchInput.focus();
    });

    els.loadMore.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderResults();
    });

    window.addEventListener("hashchange", revealHashTarget);
  }

  function prepareRow(raw) {
    const comunas = Array.isArray(raw.comunas_cubiertas) ? raw.comunas_cubiertas.filter(Boolean) : [];
    const tribunales = Array.isArray(raw.tribunales_relacionados) ? raw.tribunales_relacionados.filter(Boolean) : [];
    const emails = Array.isArray(raw.emails) ? raw.emails.filter(Boolean) : (raw.email ? [raw.email] : []);
    const flags = Array.isArray(raw.flags_calidad) ? raw.flags_calidad.filter(Boolean) : [];

    const searchText = [
      raw.nombre,
      raw.nombre_original,
      raw.corte,
      raw.territorio,
      raw.comuna_base,
      raw.tribunal_fuente,
      ...comunas,
      ...tribunales,
      ...emails,
      raw.telefono,
      raw.telefono_normalizado,
      raw.telefono_fijo
    ].filter(Boolean).join(" ");

    return {
      ...raw,
      comunas_cubiertas: comunas,
      tribunales_relacionados: tribunales,
      emails,
      flags_calidad: flags,
      _search: normalizeText(searchText),
      _corte: normalizeText(raw.corte || ""),
      _comunas: new Set(comunas.map(normalizeText)),
      _coverageEstimated: flags.some(flag => ESTIMATED_FLAGS.has(flag)),
      _unsafeWhatsapp: flags.some(flag => UNSAFE_WHATSAPP_FLAGS.has(flag))
    };
  }

  function populateFilters() {
    const cortes = uniqueSorted(state.rows.map(row => row.corte).filter(Boolean));
    const comunas = uniqueSorted(state.rows.flatMap(row => row.comunas_cubiertas));

    appendOptions(els.filterCorte, cortes, value => value.replace(/^Corte de Apelaciones de\s+/i, ""));
    appendOptions(els.filterComuna, comunas);
  }

  function appendOptions(select, values, format = value => value) {
    const fragment = document.createDocumentFragment();
    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = format(value);
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
  }

  function renderMeta() {
    const counts = state.meta?.conteos || {};
    const generated = formatDate(state.meta?.generado);
    const total = counts.receptores || state.rows.length;

    els.datasetLine.textContent = `${formatNumber(total)} receptores · fuente Poder Judicial · actualización ${generated || "no informada"}`;
    els.footerMeta.textContent = generated ? `Dataset generado: ${generated}.` : "";

    const primarySource = Array.isArray(state.meta?.fuentes)
      ? state.meta.fuentes.find(source => /transparencia/i.test(source.archivo || ""))
      : null;

    if (primarySource) {
      els.sourceText.textContent = `Fuente principal: Poder Judicial — ${primarySource.archivo}. ${primarySource.uso || ""}`.trim();
    }
  }

  function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q") || "";
    const corte = params.get("corte") || "";
    const comuna = params.get("comuna") || "";
    const contacto = params.get("contacto") || "";

    els.searchInput.value = q;
    els.clearSearch.hidden = !q;
    setIfOptionExists(els.filterCorte, corte);
    setIfOptionExists(els.filterComuna, comuna);
    setIfOptionExists(els.filterContacto, contacto);

    if (contacto) els.moreFilters.open = true;
  }

  function setIfOptionExists(select, value) {
    if (!value) return;
    const exists = [...select.options].some(option => option.value === value);
    if (exists) select.value = value;
  }

  function applyFilters({ updateUrl = true } = {}) {
    const tokens = normalizeText(els.searchInput.value).split(/\s+/).filter(Boolean);
    const corte = normalizeText(els.filterCorte.value);
    const comuna = normalizeText(els.filterComuna.value);
    const contacto = els.filterContacto.value;

    state.filtered = state.rows.filter(row => {
      if (corte && row._corte !== corte) return false;
      if (comuna && !row._comunas.has(comuna)) return false;
      if (contacto === "email" && !row.emails.length) return false;
      if (contacto === "phone" && !hasAnyPhone(row)) return false;
      if (tokens.length && !tokens.every(token => row._search.includes(token))) return false;
      return true;
    }).sort(compareRows);

    if (updateUrl) updateUrlState();
    renderResults();
  }

  function updateUrlState() {
    const params = new URLSearchParams();
    const q = els.searchInput.value.trim();

    if (q) params.set("q", q);
    if (els.filterCorte.value) params.set("corte", els.filterCorte.value);
    if (els.filterComuna.value) params.set("comuna", els.filterComuna.value);
    if (els.filterContacto.value) params.set("contacto", els.filterContacto.value);

    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }

  function renderResults() {
    const total = state.filtered.length;
    const visible = state.filtered.slice(0, state.visibleCount);

    els.resultsBody.replaceChildren(...visible.map(createRow));
    els.tableWrap.hidden = total === 0;
    els.emptyState.hidden = total !== 0;
    els.loadMoreWrap.hidden = visible.length >= total;

    const estimatedCount = state.filtered.reduce((count, row) => count + (row._coverageEstimated ? 1 : 0), 0);
    els.coverageNotice.hidden = !(estimatedCount > 0 && Boolean(els.filterComuna.value));

    if (total === 0) {
      els.resultStatus.textContent = "0 receptores";
      return;
    }

    const shown = visible.length;
    els.resultStatus.textContent = shown < total
      ? `${formatNumber(total)} receptores · mostrando ${formatNumber(shown)}`
      : `${formatNumber(total)} receptor${total === 1 ? "" : "es"}`;

    if (shown < total) {
      const remaining = total - shown;
      els.loadMore.textContent = `Mostrar ${formatNumber(Math.min(PAGE_SIZE, remaining))} más`;
    }
  }

  function createRow(row) {
    const tr = document.createElement("tr");
    if (row.id) tr.id = row.id;

    const receiverCell = document.createElement("td");
    const name = document.createElement("p");
    name.className = "receiver-name";
    name.textContent = row.nombre || "Sin nombre";
    receiverCell.appendChild(name);
    receiverCell.appendChild(createDetails(row));

    const assignmentCell = document.createElement("td");
    const primary = document.createElement("p");
    primary.className = "cell-primary";
    primary.textContent = row.tribunal_fuente || row.territorio || row.corte || "No informado";
    assignmentCell.appendChild(primary);

    if (row.corte && row.corte !== row.tribunal_fuente) {
      const court = document.createElement("p");
      court.className = "cell-secondary";
      court.textContent = row.corte;
      assignmentCell.appendChild(court);
    }

    if (row._coverageEstimated) {
      const estimate = document.createElement("span");
      estimate.className = "estimate-label";
      estimate.textContent = "Cobertura estimada · verificar";
      assignmentCell.appendChild(estimate);
    }

    const contactCell = document.createElement("td");
    contactCell.appendChild(createContactBlock(row));

    tr.append(receiverCell, assignmentCell, contactCell);
    return tr;
  }

  function createContactBlock(row) {
    const wrapper = document.createElement("div");
    wrapper.className = "contact-list";

    row.emails.slice(0, 2).forEach(email => {
      const link = document.createElement("a");
      link.href = `mailto:${email}`;
      link.textContent = email;
      wrapper.appendChild(link);
    });

    const mobile = row.telefono_normalizado || row.telefono || "";
    const fixed = row.telefono_fijo || "";

    if (mobile) {
      const tel = document.createElement("a");
      tel.href = `tel:${digitsForTel(row.telefono || row.telefono_normalizado)}`;
      tel.textContent = row.telefono_normalizado || formatLoosePhone(row.telefono);
      wrapper.appendChild(tel);
    }

    if (fixed) {
      const fixedLink = document.createElement("a");
      fixedLink.href = `tel:${digitsForTel(fixed)}`;
      fixedLink.textContent = `Fijo ${formatLoosePhone(fixed)}`;
      wrapper.appendChild(fixedLink);
    }

    if (!row.emails.length && !mobile && !fixed) {
      const missing = document.createElement("span");
      missing.className = "cell-secondary";
      missing.textContent = "Sin contacto informado";
      wrapper.appendChild(missing);
    }

    const actions = document.createElement("div");
    actions.className = "contact-actions";

    if (!row._unsafeWhatsapp && row.telefono_valido_whatsapp && row.telefono_whatsapp_normalizado) {
      const wa = document.createElement("a");
      wa.href = `https://wa.me/${row.telefono_whatsapp_normalizado}`;
      wa.target = "_blank";
      wa.rel = "noopener noreferrer";
      wa.textContent = "Abrir en WhatsApp ↗";
      actions.appendChild(wa);
    }

    if (row.id) {
      const anchor = document.createElement("a");
      anchor.href = `#${encodeURIComponent(row.id)}`;
      anchor.textContent = "Enlace";
      actions.appendChild(anchor);
    }

    if (actions.childNodes.length) wrapper.appendChild(actions);
    return wrapper;
  }

  function createDetails(row) {
    const details = document.createElement("details");
    details.className = "row-details";

    const summary = document.createElement("summary");
    summary.textContent = row._coverageEstimated ? "Cobertura estimada y fuente" : "Cobertura y fuente";
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "details-content";

    if (row.comunas_cubiertas.length) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = row._coverageEstimated ? "Comunas estimadas: " : "Comunas del dataset: ";
      p.append(strong, document.createTextNode(row.comunas_cubiertas.join(", ")));
      content.appendChild(p);
    }

    if (row.tribunales_relacionados.length) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Tribunales relacionados: ";
      p.append(strong, document.createTextNode(row.tribunales_relacionados.join(", ")));
      content.appendChild(p);
    }

    if (row.fuente || row.fecha_fuente) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Fuente: ";
      p.append(strong, document.createTextNode([row.fuente, row.fecha_fuente].filter(Boolean).join(" · ")));
      content.appendChild(p);
    }

    if (row.notas) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Nota: ";
      p.append(strong, document.createTextNode(row.notas));
      content.appendChild(p);
    }

    details.appendChild(content);
    return details;
  }

  function revealHashTarget() {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id || !state.filtered.length) return;

    const index = state.filtered.findIndex(row => row.id === id);
    if (index < 0) return;

    if (index >= state.visibleCount) {
      state.visibleCount = Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE;
      renderResults();
    }

    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    });
  }

  function hasAnyPhone(row) {
    return Boolean(row.telefono || row.telefono_normalizado || row.telefono_fijo);
  }

  function compareRows(a, b) {
    if (a._coverageEstimated !== b._coverageEstimated) return a._coverageEstimated ? 1 : -1;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" });
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));
  }

  function normalizeText(value = "") {
    return String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9ñ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function digitsForTel(value = "") {
    const digits = String(value).replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("56")) return `+${digits}`;
    if (digits.length === 9 || digits.length === 8) return `+56${digits}`;
    return digits;
  }

  function formatLoosePhone(value = "") {
    const digits = String(value).replace(/\D+/g, "");
    if (!digits) return String(value || "");
    if (digits.length === 9 && digits.startsWith("9")) return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`;
    if (digits.length === 9 && digits.startsWith("2")) return `+56 ${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    return String(value);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-CL").format(value);
  }

  function debounce(fn, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }
})();
