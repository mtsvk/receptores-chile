(() => {
  "use strict";

  const DATA_URL = "data/receptores.json";
  const META_URL = "data/meta.json";
  const PAGE_SIZE = 75;

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
      applyFilters();
    } catch (error) {
      console.error(error);
      els.resultStatus.textContent = "No fue posible cargar el dataset.";
      els.emptyState.hidden = false;
      els.emptyState.querySelector("strong").textContent = "Error al cargar datos";
      els.emptyState.querySelector("p").textContent = "Abre el sitio mediante un servidor web local o GitHub Pages; fetch() puede estar bloqueado si abres index.html directamente.";
    }
  }

  function bindElements() {
    els.searchInput = document.getElementById("searchInput");
    els.clearSearch = document.getElementById("clearSearch");
    els.filterCorte = document.getElementById("filterCorte");
    els.filterComuna = document.getElementById("filterComuna");
    els.filterContacto = document.getElementById("filterContacto");
    els.resetFilters = document.getElementById("resetFilters");
    els.resultStatus = document.getElementById("resultStatus");
    els.resultsBody = document.getElementById("resultsBody");
    els.tableWrap = document.getElementById("tableWrap");
    els.emptyState = document.getElementById("emptyState");
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
    }, 70);

    els.searchInput.addEventListener("input", () => {
      els.clearSearch.hidden = !els.searchInput.value;
      delayedFilter();
    });

    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      els.clearSearch.hidden = true;
      state.visibleCount = PAGE_SIZE;
      els.searchInput.focus();
      applyFilters();
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
      state.visibleCount = PAGE_SIZE;
      applyFilters();
      els.searchInput.focus();
    });

    els.loadMore.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderResults();
    });
  }

  function prepareRow(raw) {
    const comunas = Array.isArray(raw.comunas_cubiertas) ? raw.comunas_cubiertas.filter(Boolean) : [];
    const tribunales = Array.isArray(raw.tribunales_relacionados) ? raw.tribunales_relacionados.filter(Boolean) : [];
    const emails = Array.isArray(raw.emails) ? raw.emails.filter(Boolean) : (raw.email ? [raw.email] : []);

    const searchText = [
      raw.nombre,
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
      _search: normalizeText(searchText),
      _corte: normalizeText(raw.corte || ""),
      _comunas: new Set(comunas.map(normalizeText))
    };
  }

  function populateFilters() {
    const cortes = uniqueSorted(state.rows.map(row => row.corte).filter(Boolean));
    const comunas = uniqueSorted(state.rows.flatMap(row => row.comunas_cubiertas));

    appendOptions(els.filterCorte, cortes);
    appendOptions(els.filterComuna, comunas);
  }

  function appendOptions(select, values) {
    const fragment = document.createDocumentFragment();
    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.replace(/^Corte de Apelaciones de\s+/i, "");
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
  }

  function renderMeta() {
    const counts = state.meta?.conteos || {};
    const generated = formatDate(state.meta?.generado);
    const total = counts.receptores || state.rows.length;
    const cortes = counts.cortes || uniqueSorted(state.rows.map(row => row.corte)).length;
    const comunas = counts.comunas || uniqueSorted(state.rows.flatMap(row => row.comunas_cubiertas)).length;

    els.datasetLine.textContent = `${formatNumber(total)} receptores \u00b7 ${formatNumber(cortes)} Cortes \u00b7 ${formatNumber(comunas)} comunas \u00b7 actualizaci\u00f3n ${generated || "no informada"}`;
    els.footerMeta.textContent = generated ? `Dataset generado: ${generated}.` : "";

    const primarySource = Array.isArray(state.meta?.fuentes)
      ? state.meta.fuentes.find(source => /transparencia/i.test(source.archivo || ""))
      : null;

    if (primarySource) {
      els.sourceText.textContent = `Poder Judicial \u2014 ${primarySource.archivo}. ${primarySource.uso || ""}`.trim();
    }
  }

  function applyFilters() {
    const tokens = normalizeText(els.searchInput.value).split(/\s+/).filter(Boolean);
    const corte = normalizeText(els.filterCorte.value);
    const comuna = normalizeText(els.filterComuna.value);
    const contacto = els.filterContacto.value;

    state.filtered = state.rows.filter(row => {
      if (corte && row._corte !== corte) return false;
      if (comuna && !row._comunas.has(comuna)) return false;
      if (contacto === "email" && !row.emails.length) return false;
      if (contacto === "phone" && !hasAnyPhone(row)) return false;
      if (contacto === "whatsapp" && !row.telefono_valido_whatsapp) return false;
      if (tokens.length && !tokens.every(token => row._search.includes(token))) return false;
      return true;
    });

    renderResults();
  }

  function renderResults() {
    const total = state.filtered.length;
    const visible = state.filtered.slice(0, state.visibleCount);

    els.resultsBody.replaceChildren(...visible.map(createRow));
    els.tableWrap.hidden = total === 0;
    els.emptyState.hidden = total !== 0;
    els.loadMoreWrap.hidden = visible.length >= total;

    if (total === 0) {
      els.resultStatus.textContent = "0 resultados";
      return;
    }

    const shown = visible.length;
    els.resultStatus.textContent = shown < total
      ? `${formatNumber(total)} resultados \u00b7 mostrando ${formatNumber(shown)}`
      : `${formatNumber(total)} resultado${total === 1 ? "" : "s"}`;

    if (shown < total) {
      const remaining = total - shown;
      els.loadMore.textContent = `Mostrar ${formatNumber(Math.min(PAGE_SIZE, remaining))} m\u00e1s`;
    }
  }

  function createRow(row) {
    const tr = document.createElement("tr");

    const receiverCell = document.createElement("td");
    const name = document.createElement("p");
    name.className = "receiver-name";
    name.textContent = row.nombre || "Sin nombre";
    receiverCell.appendChild(name);

    if (row.comuna_base) {
      const base = document.createElement("p");
      base.className = "cell-secondary";
      base.textContent = `Comuna base del dataset: ${row.comuna_base}`;
      receiverCell.appendChild(base);
    }

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

    if (row.telefono_valido_whatsapp && row.telefono_whatsapp_normalizado) {
      const wa = document.createElement("a");
      wa.href = `https://wa.me/${row.telefono_whatsapp_normalizado}`;
      wa.target = "_blank";
      wa.rel = "noopener noreferrer";
      wa.textContent = "WhatsApp \u2197";
      actions.appendChild(wa);
    }

    if (row.emails[0]) {
      const mail = document.createElement("a");
      mail.href = `mailto:${row.emails[0]}`;
      mail.textContent = "Correo";
      actions.appendChild(mail);
    }

    if (actions.childNodes.length) wrapper.appendChild(actions);
    return wrapper;
  }

  function createDetails(row) {
    const details = document.createElement("details");
    details.className = "row-details";

    const summary = document.createElement("summary");
    const communeCount = row.comunas_cubiertas.length;
    const tribunalCount = row.tribunales_relacionados.length;
    const parts = [];
    if (communeCount) parts.push(`${communeCount} comuna${communeCount === 1 ? "" : "s"}`);
    if (tribunalCount) parts.push(`${tribunalCount} tribunal${tribunalCount === 1 ? "" : "es"}`);
    summary.textContent = parts.length ? `Cobertura y fuente \u00b7 ${parts.join(" \u00b7 ")}` : "Cobertura y fuente";
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "details-content";

    if (row.comunas_cubiertas.length) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Comunas del dataset: ";
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
      p.append(strong, document.createTextNode([row.fuente, row.fecha_fuente].filter(Boolean).join(" \u00b7 ")));
      content.appendChild(p);
    }

    if (row.notas) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Nota metodol\u00f3gica: ";
      p.append(strong, document.createTextNode(row.notas));
      content.appendChild(p);
    }

    details.appendChild(content);
    return details;
  }

  function hasAnyPhone(row) {
    return Boolean(row.telefono || row.telefono_normalizado || row.telefono_fijo);
  }

  function compareRows(a, b) {
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
      .replace(/[^a-z0-9\u00f1]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function digitsForTel(value = "") {
    const digits = String(value).replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("56")) return `+${digits}`;
    if (digits.length === 9) return `+56${digits}`;
    if (digits.length === 8) return `+56${digits}`;
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
    return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" }).format(date);
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