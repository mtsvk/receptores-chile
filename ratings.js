(() => {
  "use strict";
  const API = "https://receptores-analytics.adminbase100.workers.dev";
  const GOOGLE_CLIENT_ID = window.RECEPTORES_GOOGLE_CLIENT_ID || "853243855913-ibvlhhro10h4hpabjomd4vomt5m490lt.apps.googleusercontent.com";
  const REASONS = ["rapidez", "comunicacion", "disponibilidad", "cumplimiento", "trato", "honorarios"];
  const LABELS = { rapidez: "Rapidez", comunicacion: "Comunicación", disponibilidad: "Disponibilidad", cumplimiento: "Cumplimiento", trato: "Trato", honorarios: "Honorarios" };
  const DEBUG = new URLSearchParams(location.search).get("debug") === "ratings";
  const cache = new Map(), turnstileStates = new WeakMap();
  let turnstileLoad, googleIdentityLoad, googleCredential = null, googleInitialized = false;
  const googleVerificationRoots = new Set(), googleRenderStates = new WeakMap();
  const log = (...args) => DEBUG && console.log("[ratings]", ...args);
  function loadGoogleIdentity() { if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id); if (googleIdentityLoad) return googleIdentityLoad; googleIdentityLoad = new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = () => window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("google_identity_unavailable")); script.onerror = () => reject(new Error("google_identity_load_failed")); document.head.appendChild(script); }); return googleIdentityLoad; }
  async function googleLogin(root) {
    googleVerificationRoots.add(root);
    if (googleCredential) {
      markGoogleVerified(root);
      return { verified: true };
    }
    if (!GOOGLE_CLIENT_ID) throw new Error("google_client_id_not_configured");
    const container = root.querySelector(".google-signin-container");
    if (!container) throw new Error("google_signin_container_missing");
    if (googleRenderStates.has(root)) return googleRenderStates.get(root);
    const pending = loadGoogleIdentity().then(googleId => {
      if (!googleInitialized) {
        googleId.initialize({ client_id: GOOGLE_CLIENT_ID, callback: response => {
          if (!response?.credential) {
            googleVerificationRoots.forEach(showGoogleError);
            return;
          }
          googleCredential = response.credential;
          googleVerificationRoots.forEach(markGoogleVerified);
        } });
        googleInitialized = true;
      }
      container.replaceChildren();
      googleId.renderButton(container, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular" });
    }).catch(error => {
      showGoogleError(root);
      debugError(error);
      googleRenderStates.delete(root);
      throw error;
    });
    googleRenderStates.set(root, pending);
    return pending;
  }
  function markGoogleVerified(root) {
    const container = root.querySelector(".google-signin-container");
    const status = root.querySelector("[data-google-status]");
    if (container) container.hidden = true;
    if (status) status.textContent = "✓ Cuenta Google verificada";
  }
  function showGoogleError(root) {
    const status = root.querySelector("[data-google-status]");
    if (status) status.textContent = "No fue posible cargar la verificación con Google. Intenta nuevamente.";
  }
  function browserId() { try { let id = localStorage.getItem("receptores_browser_id"); if (!/^[A-Za-z0-9_-]{16,128}$/.test(id || "")) { id = crypto.randomUUID().replaceAll("-", ""); localStorage.setItem("receptores_browser_id", id); } return id; } catch { return ""; } }
  function myVote(id) { try { return Number(localStorage.getItem(`receptores_vote:${id}`)) || 0; } catch { return 0; } }
  function markRecommended(id) { try { localStorage.setItem(`receptores_recommendation:${id}`, "1"); } catch {} }
  function isRecommended(id) { try { return localStorage.getItem(`receptores_recommendation:${id}`) === "1" || myVote(id) === 1; } catch { return myVote(id) === 1; } }
  function debugError(error) { log("error", error); }
  function createWidget(id, options = {}) {
    const root = document.createElement("section"); root.className = "rating-widget"; root.dataset.receptorId = id; root.setAttribute("aria-label", "Recomendación y comentario");
    if (options.compact) {
      root.innerHTML = `<div class="rating-compact"><span class="rating-summary" aria-live="polite">Cargando recomendaciones…</span><button type="button" data-recommend aria-label="Recomendar receptor" aria-pressed="false">Recomendar</button></div><div class="rating-status" role="status" aria-live="polite"></div>`;
      root.addEventListener("click", event => { if (event.target.closest("button[data-recommend]")) chooseRecommend(root); });
      return root;
    }
    root.innerHTML = `<div class="rating-title">Recomendaciones</div><div class="rating-summary" aria-live="polite">Cargando recomendaciones…</div><div class="rating-actions"><button type="button" data-recommend aria-label="Recomendar receptor" aria-pressed="false">Recomendar</button><button type="button" data-feedback-toggle>Enviar comentario</button></div><div class="rating-status" role="status" aria-live="polite"></div><p class="rating-note">Las recomendaciones son anónimas. Los comentarios son privados por defecto y, si lo autorizas, pueden enviarse a moderación para aparecer en la ficha del receptor.</p><form class="rating-feedback" hidden><div class="google-verification"><p>Para enviar comentarios debes verificarte con Google.</p><div class="google-signin-container"></div><span data-google-status role="status"></span><label class="rating-public-consent"><input type="checkbox" name="allow_publication"> Autorizo que este comentario pueda publicarse sin mostrar mi identidad en la sección "Comentarios de usuarios" de la ficha de este receptor, sujeto a moderación.</label><p class="rating-public-note">Si no marcas esta opción, el comentario permanecerá privado.</p><p class="rating-public-note" data-publication-note hidden>Si es aprobado, aparecerá públicamente en la ficha de este receptor. La autorización no garantiza su publicación. No incluyas datos de causas, RUT, teléfonos, correos ni datos personales de terceros.</p></div><fieldset><legend>¿Qué influyó en tu experiencia?</legend>${REASONS.map(reason => `<label><input type="checkbox" name="reason" value="${reason}"> ${LABELS[reason]}</label>`).join("")}</fieldset><label class="rating-comment"><span class="rating-comment-label">Comentario opcional</span><textarea name="comment" maxlength="300" rows="3"></textarea></label><div class="turnstile-slot"><span class="turnstile-status" role="status" aria-live="polite"></span></div><button type="submit">Enviar comentario</button><span class="feedback-message" role="status" aria-live="polite"></span></form>`;
    root.querySelector("button[data-feedback-toggle]").textContent = "Escribir comentario";
    root.addEventListener("click", event => { if (event.target.closest("button[data-recommend]")) chooseRecommend(root); if (event.target.closest("button[data-feedback-toggle]")) toggleFeedback(root); });
    root.querySelector("form").addEventListener("submit", event => { event.preventDefault(); requestSubmission(root, submitFeedback); });
    root.querySelector("input[name=allow_publication]").addEventListener("change", () => updatePublicationMode(root));
    updatePublicationMode(root);
    return root;
  }
  function widget(id, options = {}) {
    const root = createWidget(id, options);
    root.dataset.bound = "1";
    return root;
  }
  function update(root, rating) { const total = rating.recommendations || 0; root.querySelector(".rating-summary").textContent = `${total} ${total === 1 ? "recomendación" : "recomendaciones"}`; const button = root.querySelector("button[data-recommend]"); const active = isRecommended(root.dataset.receptorId); button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", String(active)); button.textContent = active ? "Recomendado" : "Recomendar"; }
  function turnstileState(root) { let state = turnstileStates.get(root); if (!state) { state = { widgetId: null, pending: false, pendingSubmit: null, pendingType: null, submitting: false }; turnstileStates.set(root, state); } return state; }
  function setStatus(root, text, type) { root.querySelector(type === "feedback" ? ".feedback-message" : ".rating-status").textContent = text; }
  function setRecommendationLoading(root, loading) { const button = root.querySelector("button[data-recommend]"); button.disabled = loading; button.setAttribute("aria-busy", String(loading)); if (loading) button.innerHTML = '<span class="rating-spinner" aria-hidden="true"></span>Procesando…'; else button.textContent = isRecommended(root.dataset.receptorId) ? "Recomendado" : "Recomendar"; }
  function chooseRecommend(root) { const state = turnstileState(root); if (state.submitting || isRecommended(root.dataset.receptorId)) return; setRecommendationLoading(root, true); requestSubmission(root, submitRecommendation); }
  function toggleFeedback(root) { const form = root.querySelector(".rating-feedback"); form.hidden = !form.hidden; if (!form.hidden) { root.querySelector(".feedback-message").textContent = ""; updatePublicationMode(root); googleLogin(root).catch(() => {}); } }
  function updatePublicationMode(root) { const form = root.querySelector(".rating-feedback"), consent = form?.elements.namedItem("allow_publication"), textarea = form?.elements.namedItem("comment"), label = root.querySelector(".rating-comment-label"), note = root.querySelector("[data-publication-note]"), enabled = Boolean(consent?.checked); if (textarea) textarea.required = enabled; if (label) label.textContent = enabled ? "Comentario" : "Comentario opcional"; if (note) note.hidden = !enabled; }
  function setTurnstileStatus(root, text) { const status = root.querySelector(".turnstile-status"); if (status) status.textContent = text; }
  function resetTurnstile(root) { const state = turnstileState(root), slot = root.querySelector(".turnstile-slot"); delete slot.dataset.token; setTurnstileStatus(root, ""); if (state.widgetId !== null && window.turnstile?.reset) window.turnstile.reset(state.widgetId); }
  function loadTurnstile() { if (window.turnstile) return Promise.resolve(); if (turnstileLoad) return turnstileLoad; turnstileLoad = new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"; script.async = true; script.onload = resolve; script.onerror = () => reject(new Error("turnstile_load_failed")); document.head.appendChild(script); }); return turnstileLoad; }
  async function ensureTurnstile(root) {
    const key = window.RECEPTORES_TURNSTILE_SITE_KEY || "", slot = root.querySelector(".turnstile-slot"), state = turnstileState(root);
    if (!key) { setStatus(root, "Configura Turnstile para enviar.", state.pendingType); return false; }
    if (state.widgetId !== null || slot.dataset.widgetId) { state.widgetId = state.widgetId === null ? slot.dataset.widgetId : state.widgetId; return true; }
    try { await loadTurnstile(); } catch (_) { setStatus(root, "No fue posible cargar la verificación de seguridad.", state.pendingType); return false; }
    const widgetId = window.turnstile.render(slot, { sitekey: key, callback: token => { slot.dataset.token = token; setTurnstileStatus(root, "✓ Verificación de seguridad completada"); if (state.pending && !state.submitting) { const submit = state.pendingSubmit; state.pending = false; state.pendingSubmit = null; if (submit) { setTurnstileStatus(root, ""); submit(root); } } }, "expired-callback": () => { delete slot.dataset.token; setTurnstileStatus(root, ""); if (state.pending) { state.pending = false; state.pendingSubmit = null; setStatus(root, "La verificación expiró. Inténtalo nuevamente.", state.pendingType); if (state.pendingType === "recommendation") setRecommendationLoading(root, false); } }, "error-callback": () => { delete slot.dataset.token; setTurnstileStatus(root, ""); state.pending = false; state.pendingSubmit = null; setStatus(root, "No fue posible validar la verificación de seguridad.", state.pendingType); if (state.pendingType === "recommendation") setRecommendationLoading(root, false); } });
    state.widgetId = widgetId; slot.dataset.widgetId = String(widgetId); return true;
  }
  async function requestSubmission(root, submit) { const state = turnstileState(root), slot = root.querySelector(".turnstile-slot"), hadWidget = state.widgetId !== null || Boolean(slot.dataset.widgetId); state.pending = true; state.pendingSubmit = submit; state.pendingType = submit === submitRecommendation ? "recommendation" : "feedback"; if (!await ensureTurnstile(root)) { state.pending = false; state.pendingSubmit = null; if (state.pendingType === "recommendation") setRecommendationLoading(root, false); return; } if (hadWidget) resetTurnstile(root); }
  async function submitRecommendation(root) { const state = turnstileState(root); if (state.submitting) return; const slot = root.querySelector(".turnstile-slot"), id = root.dataset.receptorId, token = slot.dataset.token || "", message = root.querySelector(".rating-status"); if (!token) { message.textContent = "Completa la verificación de seguridad para recomendar."; setRecommendationLoading(root, false); state.pending = false; state.pendingSubmit = null; return; } state.submitting = true; delete slot.dataset.token; const payload = { receptor_id: id, vote: 1, browser_id: browserId(), turnstile_token: token }; try { const response = await fetch(`${API}/vote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.code = data.error; throw error; } markRecommended(id); cache.set(id, data); update(root, data); const remaining = Number.isInteger(data.recommendations_remaining_today) ? data.recommendations_remaining_today : null; message.textContent = remaining === 0 ? "Ya usaste tus 5 recomendaciones de hoy. Vuelve mañana =)" : remaining === 1 ? "Te queda 1 recomendación por hoy, úsala bien." : remaining >= 2 ? `Te quedan ${remaining} recomendaciones por hoy, úsalas bien.` : "Recomendación guardada."; } catch (error) { message.textContent = error.code === "daily_recommendation_limit" ? "Ya usaste tus 5 recomendaciones de hoy. Vuelve mañana =)" : "No fue posible guardar la recomendación."; debugError(error); } finally { state.submitting = false; state.pending = false; state.pendingSubmit = null; state.pendingType = null; setRecommendationLoading(root, false); } }
  function expireGoogleVerification() {
    googleCredential = null;
    googleVerificationRoots.forEach(root => {
      const container = root.querySelector(".google-signin-container");
      const status = root.querySelector("[data-google-status]");
      if (container) { container.hidden = false; container.replaceChildren(); }
      if (status) status.textContent = "La verificación con Google expiró. Verifícate nuevamente.";
      googleRenderStates.delete(root);
      googleLogin(root).catch(() => {});
    });
  }
  async function submitFeedback(root) {
    const state = turnstileState(root);
    if (state.submitting) return;
    const form = root.querySelector("form"), slot = root.querySelector(".turnstile-slot"), id = root.dataset.receptorId;
    const token = slot.dataset.token || "", reasons = [...form.querySelectorAll("input[name=reason]:checked")].map(input => input.value);
    const comment = form.comment.value.trim(), allowPublication = form.allow_publication.checked, message = root.querySelector(".feedback-message"), submit = form.querySelector("button[type=submit]");
    if (!googleCredential) { message.textContent = "Verifícate con Google antes de enviar."; return; }
    if (!token) { message.textContent = "Completa la verificación de seguridad para enviar."; return; }
    if (allowPublication && !comment) { message.textContent = "Escribe un comentario para solicitar su publicación."; return; }
    state.submitting = true;
    submit.disabled = true;
    submit.textContent = "Enviando…";
    delete slot.dataset.token;
    setTurnstileStatus(root, "");
    try {
      let response;
      try {
        response = await fetch(`${API}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receptor_id: id, browser_id: browserId(), turnstile_token: token, google_credential: googleCredential, reasons, comment, allow_publication: allowPublication }) });
      } catch (error) { error.code = "network_error"; throw error; }
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.code = data.error; throw error; }
      message.classList.add("feedback-success");
      message.textContent = allowPublication ? "✓ Comentario enviado correctamente.\nQuedó pendiente de moderación. Si se aprueba, aparecerá en la sección \"Comentarios de usuarios\" de la ficha de este receptor." : "✓ Comentario enviado correctamente.\nQuedó guardado como privado y no aparecerá públicamente en la ficha.";
      form.reset();
      updatePublicationMode(root);
      resetTurnstile(root);
      if (googleCredential) markGoogleVerified(root);
    } catch (error) {
      message.classList.remove("feedback-success");
      if (error.code === "google_verification_required") { expireGoogleVerification(); message.textContent = "La verificación con Google expiró. Verifícate nuevamente."; }
      else if (error.code === "turnstile_failed") message.textContent = "La verificación de seguridad expiró o no pudo validarse. Intenta nuevamente.";
      else if (error.code === "public_comment_requires_text") message.textContent = "Escribe un comentario para solicitar su publicación.";
      else if (error.code === "rate_limited") message.textContent = "Has enviado demasiados comentarios en poco tiempo. Intenta más tarde.";
      else if (error.code === "network_error") message.textContent = "No pudimos confirmar el envío. Revisa tu conexión e intenta nuevamente.";
      else message.textContent = "No fue posible completar el envío. Intenta nuevamente.";
      debugError(error);
    } finally {
      state.submitting = false;
      state.pending = false;
      state.pendingSubmit = null;
      state.pendingType = null;
      submit.disabled = false;
      submit.textContent = "Enviar comentario";
    }
  }
  async function load(ids, roots) { const missing = [...new Set(ids)].filter(id => !cache.has(id)); if (!missing.length) return; try { const response = await fetch(`${API}/ratings?ids=${encodeURIComponent(missing.join(","))}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); Object.entries(data.ratings || {}).forEach(([id, rating]) => cache.set(id, rating)); } catch (error) { debugError(error); } roots.forEach(root => { if (cache.has(root.dataset.receptorId)) update(root, cache.get(root.dataset.receptorId)); }); }
  function formatPublishedDate(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  }
  function loadPublicComments() {
    document.querySelectorAll("[data-public-comments]").forEach(container => {
      const id = container.dataset.receptorId;
      if (!id) return;
      fetch(API + "/comments?receptor_id=" + encodeURIComponent(id)).then(response => { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }).then(data => {
        const list = container.querySelector(".public-comments-list"), empty = container.querySelector(".public-comments-empty");
        if (!list) return;
        list.replaceChildren();
        const comments = Array.isArray(data.comments) ? data.comments : [];
        if (!comments.length) { if (empty) empty.hidden = false; return; }
        if (empty) empty.hidden = true;
        comments.forEach(item => {
          const article = document.createElement("article"); article.className = "public-comment";
          const body = document.createElement("p"); body.className = "public-comment-text"; body.textContent = String(item.comment || ""); article.appendChild(body);
          const reasons = document.createElement("p"); reasons.className = "public-comment-reasons"; reasons.textContent = (Array.isArray(item.reasons) ? item.reasons : []).map(reason => ({ rapidez: "Rapidez", comunicacion: "Comunicación", disponibilidad: "Disponibilidad", cumplimiento: "Cumplimiento", trato: "Trato", honorarios: "Honorarios" }[reason])).filter(Boolean).join(" · "); if (reasons.textContent) article.appendChild(reasons);
          const meta = document.createElement("p"); meta.className = "public-comment-meta"; meta.textContent = "Cuenta Google verificada" + (formatPublishedDate(item.published_at) ? " · " + formatPublishedDate(item.published_at) : ""); article.appendChild(meta);
          list.appendChild(article);
        });
      }).catch(error => debugError(error));
    });
  }
  function scan(roots = [...document.querySelectorAll(".rating-widget")]) { roots = roots.filter(root => root.matches?.(".rating-widget")).map(root => { if (root.dataset.bound) return root; const id = root.dataset.receptorId; if (!id) return root; const replacement = widget(id); root.replaceWith(replacement); return replacement; }); roots.forEach(root => { if (cache.has(root.dataset.receptorId)) update(root, cache.get(root.dataset.receptorId)); }); load(roots.map(root => root.dataset.receptorId), roots); }
  function scanAdded(records) { const roots = records.flatMap(record => [...record.addedNodes].flatMap(node => node.nodeType === 1 ? [node, ...node.querySelectorAll(".rating-widget")] : [])); if (roots.length) scan(roots); }
  function init() { scan(); loadPublicComments(); const list = document.getElementById("list"); if (list) new MutationObserver(scanAdded).observe(list, { childList: true }); }
  window.ReceptoresRatings = { widget, scan };
  window.ReceptoresAuth = { loadGoogleIdentity, login: googleLogin };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
