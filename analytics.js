(() => {
  "use strict";

  const ENDPOINT =
    "https://receptores-analytics.adminbase100.workers.dev/event";

  const SEARCH_DELAY = 800;

  let searchTimer = null;
  let lastSearchSignature = "";

  function analyticsDebugEnabled() {
    return new URLSearchParams(location.search).get("debug") === "analytics";
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem("receptores_session_id");

      if (!id) {
        id = crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        sessionStorage.setItem("receptores_session_id", id);
      }

      return id;
    } catch {
      return null;
    }
  }

  function basePayload(eventType, extra = {}) {
    return {
      event_type: eventType,
      path: location.pathname + location.search,
      referrer: document.referrer || null,
      session_id: getSessionId(),
      ...extra
    };
  }

  function send(eventType, extra = {}, navigation = false) {
    const payload = basePayload(eventType, extra);
    const body = JSON.stringify(payload);

    if (analyticsDebugEnabled()) {
      console.log("[analytics] event", payload);
    }

    if (navigation && navigator.sendBeacon) {
      const blob = new Blob(
        [body],
        { type: "text/plain;charset=UTF-8" }
      );

      if (navigator.sendBeacon(ENDPOINT, blob)) {
        return;
      }
    }

    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body,
      keepalive: true
    }).catch(() => {});
  }

  function parseResultCount() {
    const el = document.getElementById("status");

    if (!el) return null;

    const text = el.textContent
      .replace(/\u00a0/g, " ")
      .trim();

    const match = text.match(
      /([\d.\s]+)\s+receptor/i
    );

    if (!match) return null;

    const value = match[1].replace(/\D/g, "");

    return value ? Number(value) : null;
  }

  function currentSearch() {
    return {
      query:
        document.getElementById("q")
          ?.value.trim() || "",

      corte:
        document.getElementById("corte")
          ?.value || "",

      comuna:
        document.getElementById("comuna")
          ?.value || "",

      contacto:
        document.getElementById("contacto")
          ?.value || ""
    };
  }

  function sendSearch() {
    const current = currentSearch();

    const active =
      current.query ||
      current.corte ||
      current.comuna ||
      current.contacto;

    if (!active) {
      lastSearchSignature = "";
      return;
    }

    const count = parseResultCount();

    const signature = JSON.stringify([
      current.query,
      current.corte,
      current.comuna,
      current.contacto,
      count
    ]);

    if (signature === lastSearchSignature) {
      return;
    }

    lastSearchSignature = signature;

    send("search", {
      query_text: current.query,
      corte: current.corte,
      comuna: current.comuna,
      results_count: count
    });
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(
      sendSearch,
      SEARCH_DELAY
    );
  }

  function receptorFromPage() {
    const explicit =
      document.querySelector(
        'meta[name="receptor-id"]'
      )?.content;

    return /^rec-\d+-[^/]+$/i.test(explicit || "") ? explicit : null;
  }

  function receptorFromLink(link) {
    const row = link.closest('[id^="rec-"]');

    if (row) {
      if (/^rec-\d+-/.test(row.id)) {
        return row.id;
      }

      const permalink =
        row.querySelector(
          'a[href^="#rec-"]'
        );

      if (permalink) {
        return decodeURIComponent(
          permalink
            .getAttribute("href")
            .replace(/^#/, "")
        );
      }
    }

    return receptorFromPage();
  }

  function contactType(link) {
    const href =
      link.getAttribute("href") || "";

    if (href.startsWith("tel:")) {
      return "telefono";
    }

    if (href.startsWith("mailto:")) {
      return "email";
    }

    if (/^https:\/\/wa\.me\//i.test(href)) {
      return "whatsapp";
    }

    return null;
  }

  function hookHistory() {
    ["pushState", "replaceState"].forEach(
      method => {
        const original = history[method];

        history[method] = function (...args) {
          const result =
            original.apply(this, args);

          scheduleSearch();

          return result;
        };
      }
    );

    window.addEventListener(
      "popstate",
      scheduleSearch
    );
  }

  function init() {
    hookHistory();

    document
      .getElementById("q")
      ?.addEventListener(
        "input",
        scheduleSearch
      );

    [
      "corte",
      "comuna",
      "contacto"
    ].forEach(id => {
      document
        .getElementById(id)
        ?.addEventListener(
          "change",
          scheduleSearch
        );
    });

    const resultStatus =
      document.getElementById("status");

    if (resultStatus) {
      new MutationObserver(
        scheduleSearch
      ).observe(
        resultStatus,
        {
          childList: true,
          subtree: true,
          characterData: true
        }
      );
    }

    document.addEventListener(
      "click",
      event => {
        if (!(event.target instanceof Element)) {
          return;
        }

        const link =
          event.target.closest("a");

        if (!link) return;

        const type = contactType(link);

        if (!type) return;

        send(
          "contact_click",
          {
            receptor_id:
              receptorFromLink(link),

            contact_type: type
          },
          true
        );
      },
      true
    );

    const receptor =
      receptorFromPage();

    if (receptor) {
      send("receptor_open", {
        receptor_id: receptor
      });
    }

    if (location.search) {
      scheduleSearch();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();
