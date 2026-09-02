const PROD_ORIGIN = "https://receptores.vukusic.cl";
const DEV_ORIGINS = new Set(["http://localhost:8000", "http://127.0.0.1:8000"]);
const VALID_EVENTS = new Set(["search", "receptor_open", "contact_click"]);
const VALID_CONTACT_TYPES = new Set(["telefono", "whatsapp", "email"]);
const VALID_REASONS = new Set(["rapidez", "comunicacion", "disponibilidad", "cumplimiento", "trato", "honorarios"]);
const RECEPTOR_ID = /^rec-\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function text(value, max = 250) { if (value === null || value === undefined) return null; const result = String(value).trim(); return result ? result.slice(0, max) : null; }
function integer(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null; }
function allowedOrigin(origin) { return origin === PROD_ORIGIN || DEV_ORIGINS.has(origin); }
function corsHeaders(origin, methods = "GET, POST, OPTIONS") { return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": methods, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" }; }
function json(data, status = 200, origin = PROD_ORIGIN) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } }); }
async function hmac(secret, value) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))); return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function verifyHmac(secret, value, expectedHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = new Uint8Array(expectedHex.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
  return crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(value));
}
function sameSecret(left, right) {
  const a = new TextEncoder().encode(String(left || "")), b = new TextEncoder().encode(String(right || ""));
  const length = Math.max(a.length, b.length); let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
function webhookMessages(body) {
  const messages = [];
  if (!body || !Array.isArray(body.entry)) return messages;
  for (const entry of body.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const incoming = change?.value?.messages;
      if (Array.isArray(incoming)) messages.push(...incoming);
    }
  }
  return messages;
}
async function handleWhatsAppWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode"), token = url.searchParams.get("hub.verify_token"), challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && sameSecret(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) && challenge !== null) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.WHATSAPP_APP_SECRET) return new Response("WhatsApp webhook is not configured: WHATSAPP_APP_SECRET is missing", { status: 503 });
  if (!env.VOTE_HMAC_SECRET) return new Response("WhatsApp webhook is not configured: VOTE_HMAC_SECRET is missing", { status: 503 });
  const rawBody = await request.text(), signature = request.headers.get("X-Hub-Signature-256") || "";
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature) || !await verifyHmac(env.WHATSAPP_APP_SECRET, rawBody, signature.slice(7).toLowerCase())) return new Response("Invalid webhook signature", { status: 401 });
  let body; try { body = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
  for (const message of webhookMessages(body)) {
    const sender = typeof message?.from === "string" ? message.from.trim() : "";
    if (!sender) continue;
    const messageId = typeof message?.id === "string" ? message.id : null;
    const messageText = typeof message?.text?.body === "string" ? message.text.body : null;
    const userKey = await hmac(env.VOTE_HMAC_SECRET, `whatsapp-user\n${sender}`);
    console.log("whatsapp_message", { message_id: messageId, user_key: userKey });
  }
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
function ipOf(request) { return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "unknown"; }
function base64UrlBytes(value) { const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); const binary = atob(normalized); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
function parseJwtPart(value) { try { return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))); } catch { return null; } }
async function verifyGoogleIdToken(token, clientId) {
  if (typeof token !== "string" || token.length > 16384) return null;
  const parts = token.split("."); if (parts.length !== 3) return null;
  const header = parseJwtPart(parts[0]), claims = parseJwtPart(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") || claims.aud !== clientId || typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  let jwks; try { const response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: "application/json" } }); if (!response.ok) return null; jwks = await response.json(); } catch { return null; }
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find(key => key?.kid === header.kid && key?.kty === "RSA") : null; if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) ? claims : null;
  } catch { return null; }
}
async function voterKey(browserId, secret) { return hmac(secret, browserId); }
export function chileDateKey(date = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function periodKey(date, period) { const iso = date.toISOString(); return period === "hour" ? iso.slice(0, 13) : iso.slice(0, 10); }
async function enforceRateLimit(db, request, secret) {
  const now = new Date(), ip = ipOf(request);
  const hourKey = await hmac(secret, `rate\nhour\n${ip}\n${periodKey(now, "hour")}`), dayKey = await hmac(secret, `rate\nday\n${ip}\n${periodKey(now, "day")}`);
  const rows = await db.batch([db.prepare("SELECT count FROM vote_rate_limits WHERE bucket_key = ?").bind(hourKey), db.prepare("SELECT count FROM vote_rate_limits WHERE bucket_key = ?").bind(dayKey)]);
  if (Number(rows[0].results?.[0]?.count || 0) >= 20) return { ok: false, retry_after: 3600 };
  if (Number(rows[1].results?.[0]?.count || 0) >= 60) return { ok: false, retry_after: 86400 };
  await db.batch([db.prepare("INSERT INTO vote_rate_limits (bucket_key, period, count, updated_at) VALUES (?, 'hour', 1, datetime('now')) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1, updated_at = datetime('now')").bind(hourKey), db.prepare("INSERT INTO vote_rate_limits (bucket_key, period, count, updated_at) VALUES (?, 'day', 1, datetime('now')) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1, updated_at = datetime('now')").bind(dayKey)]);
  return { ok: true };
}
async function verifyTurnstile(token, request, env) { if (!env.TURNSTILE_SECRET_KEY || !token) return false; const form = new FormData(); form.append("secret", env.TURNSTILE_SECRET_KEY); form.append("response", token); const ip = request.headers.get("CF-Connecting-IP"); if (ip) form.append("remoteip", ip); try { const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form }); return response.ok && (await response.json()).success === true; } catch { return false; } }
function recommendationCount(row) { return Number(row?.recommendations || 0); }
function publicRating(row) { const recommendations = recommendationCount(row); return { recommendations }; }
function rankingScore(recommendations) { return Math.log1p(recommendations); }
async function handleEvent(request, env, origin) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return json({ ok: false, error: "payload_too_large" }, 413, origin);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, origin); }
  const eventType = text(body.event_type, 40); if (!VALID_EVENTS.has(eventType)) return json({ ok: false, error: "invalid_event_type" }, 400, origin);
  let contactType = text(body.contact_type, 30); if (contactType && !VALID_CONTACT_TYPES.has(contactType)) contactType = null;
  await env.receptores_analytics_db.prepare(`INSERT INTO events (event_type, receptor_id, query_text, corte, comuna, results_count, contact_type, path, referrer, country, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(eventType, text(body.receptor_id, 160), text(body.query_text, 160), text(body.corte, 160), text(body.comuna, 160), integer(body.results_count), contactType, text(body.path, 300), text(body.referrer, 500), text(request.cf?.country, 8), text(body.session_id, 80)).run();
  return json({ ok: true }, 201, origin);
}
async function handleVote(request, env, origin) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return json({ ok: false, error: "payload_too_large" }, 413, origin);
  if ((request.headers.get("Content-Type") || "").split(";")[0].toLowerCase() !== "application/json") return json({ ok: false, error: "invalid_content_type" }, 415, origin);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, origin); }
  const receptorId = text(body.receptor_id, 160), browserId = text(body.browser_id, 128);
  if (!RECEPTOR_ID.test(receptorId || "")) return json({ ok: false, error: "invalid_receptor_id" }, 400, origin);
  if (!browserId || !/^[A-Za-z0-9_-]{16,128}$/.test(browserId)) return json({ ok: false, error: "invalid_browser_id" }, 400, origin);
  if (body.vote !== 1) return json({ ok: false, error: "invalid_vote" }, 400, origin);
  if (!env.VOTE_HMAC_SECRET) return json({ ok: false, error: "server_not_configured" }, 503, origin);
  if (!await verifyTurnstile(text(body.turnstile_token, 4096), request, env)) return json({ ok: false, error: "turnstile_failed" }, 403, origin);
  const key = await voterKey(browserId, env.VOTE_HMAC_SECRET || "");
  const existing = await env.receptores_analytics_db.prepare("SELECT vote FROM votes WHERE receptor_id = ? AND voter_key = ?").bind(receptorId, key).first();
  if (existing) {
    await env.receptores_analytics_db.prepare("UPDATE votes SET vote = 1, updated_at = datetime('now') WHERE receptor_id = ? AND voter_key = ?").bind(receptorId, key).run();
    return json({ ok: true, receptor_id: receptorId, ...(await ratingFor(env.receptores_analytics_db, receptorId)), recommended: true, recommendations_remaining_today: await recommendationRemaining(env.receptores_analytics_db, request, env.VOTE_HMAC_SECRET || "") }, 200, origin);
  }
  const limit = await enforceRecommendationLimit(env.receptores_analytics_db, request, env.VOTE_HMAC_SECRET || ""); if (!limit.ok) return json({ ok: false, error: "daily_recommendation_limit", limit: 5 }, 429, origin);
  await env.receptores_analytics_db.prepare("INSERT INTO votes (receptor_id, voter_key, vote, created_at, updated_at) VALUES (?, ?, 1, datetime('now'), datetime('now')) ON CONFLICT(receptor_id, voter_key) DO UPDATE SET vote = 1, updated_at = datetime('now')").bind(receptorId, key).run();
  return json({ ok: true, receptor_id: receptorId, ...(await ratingFor(env.receptores_analytics_db, receptorId)), recommended: true, recommendations_remaining_today: limit.remaining }, 200, origin);
}
async function recommendationBucketKey(request, secret) { return hmac(secret, `recommendation/day/IP-hash/${chileDateKey()}\n${ipOf(request)}`); }
async function recommendationRemaining(db, request, secret) { const bucketKey = await recommendationBucketKey(request, secret); const row = await db.prepare("SELECT count FROM vote_rate_limits WHERE bucket_key = ? AND period = 'day'").bind(bucketKey).first(); return Math.max(0, 5 - Number(row?.count || 0)); }
async function enforceRecommendationLimit(db, request, secret) { const bucketKey = await recommendationBucketKey(request, secret); const result = await db.prepare("INSERT INTO vote_rate_limits (bucket_key, period, count, updated_at) VALUES (?, 'day', 1, datetime('now')) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1, updated_at = datetime('now') WHERE count < 5").bind(bucketKey).run(); if (Number(result.meta?.changes || 0) !== 1) return { ok: false, remaining: 0 }; return { ok: true, remaining: await recommendationRemaining(db, request, secret) }; }
async function handleFeedback(request, env, origin) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return json({ ok: false, error: "payload_too_large" }, 413, origin);
  if ((request.headers.get("Content-Type") || "").split(";")[0].toLowerCase() !== "application/json") return json({ ok: false, error: "invalid_content_type" }, 415, origin);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, origin); }
  const receptorId = text(body.receptor_id, 160), browserId = text(body.browser_id, 128);
  if (!RECEPTOR_ID.test(receptorId || "")) return json({ ok: false, error: "invalid_receptor_id" }, 400, origin);
  if (!browserId || !/^[A-Za-z0-9_-]{16,128}$/.test(browserId)) return json({ ok: false, error: "invalid_browser_id" }, 400, origin);
  const reasons = body.reasons === undefined ? [] : body.reasons;
  if (!Array.isArray(reasons) || reasons.length > 6 || reasons.some(reason => typeof reason !== "string" || !VALID_REASONS.has(reason))) return json({ ok: false, error: "invalid_reasons" }, 400, origin);
  const comment = body.comment === undefined || body.comment === null ? "" : String(body.comment).trim();
  if (comment.length > 300 || /[<>]/.test(comment)) return json({ ok: false, error: "invalid_comment" }, 400, origin);
  if (!env.VOTE_HMAC_SECRET || !env.GOOGLE_CLIENT_ID) return json({ ok: false, error: "server_not_configured" }, 503, origin);
  if (!await verifyTurnstile(text(body.turnstile_token, 4096), request, env)) return json({ ok: false, error: "turnstile_failed" }, 403, origin);
  const limit = await enforceRateLimit(env.receptores_analytics_db, request, env.VOTE_HMAC_SECRET || ""); if (!limit.ok) return json({ ok: false, error: "rate_limited", retry_after: limit.retry_after }, 429, origin);
  const claims = await verifyGoogleIdToken(body.google_credential, env.GOOGLE_CLIENT_ID); if (!claims) return json({ ok: false, error: "google_verification_required" }, 403, origin);
  const key = await hmac(env.VOTE_HMAC_SECRET, `google-user\n${claims.sub}`);
  await env.receptores_analytics_db.prepare("INSERT INTO private_feedback (receptor_id, voter_key, reasons_json, comment, moderation_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'private', datetime('now'), datetime('now')) ON CONFLICT(receptor_id, voter_key) DO UPDATE SET reasons_json = excluded.reasons_json, comment = excluded.comment, updated_at = datetime('now')").bind(receptorId, key, JSON.stringify(reasons), comment || null).run();
  return json({ ok: true, receptor_id: receptorId }, 201, origin);
}
async function ratingFor(db, id) { return publicRating(await db.prepare("SELECT COUNT(*) AS recommendations FROM votes WHERE receptor_id = ? AND vote = 1").bind(id).first()); }
async function handleRatings(url, env, origin) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(id => id.trim()).filter(Boolean))]; if (!ids.length || ids.length > 100 || ids.some(id => !RECEPTOR_ID.test(id))) return json({ ok: false, error: "invalid_ids" }, 400, origin);
  const result = await env.receptores_analytics_db.prepare(`SELECT receptor_id, COUNT(*) AS recommendations FROM votes WHERE vote = 1 AND receptor_id IN (${ids.map(() => "?").join(",")}) GROUP BY receptor_id`).bind(...ids).all();
  return json({ ratings: Object.fromEntries(ids.map(id => [id, publicRating(result.results.find(row => row.receptor_id === id))])) }, 200, origin);
}
async function handleTop(url, env, origin) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100) || 100));
  const result = await env.receptores_analytics_db.prepare("SELECT receptor_id, COUNT(*) AS recommendations FROM votes WHERE vote = 1 GROUP BY receptor_id").all();
  const ratings = result.results.map(row => ({ receptor_id: row.receptor_id, ...publicRating(row) })).filter(row => row.recommendations >= 5).map(row => ({ ...row, ranking_score: rankingScore(row.recommendations) })).sort((a, b) => b.recommendations - a.recommendations || b.ranking_score - a.ranking_score).slice(0, limit);
  return json({ ratings }, 200, origin);
}
export default { async fetch(request, env) {
  const url = new URL(request.url), origin = request.headers.get("Origin") || "";
  if (url.pathname === "/health" && request.method === "GET") return new Response(JSON.stringify({ ok: true, service: "receptores-analytics" }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  if (url.pathname === "/whatsapp/webhook") return handleWhatsAppWebhook(request, env);
  if (!allowedOrigin(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (url.pathname === "/event") return request.method === "POST" ? handleEvent(request, env, origin) : json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (url.pathname === "/vote") return request.method === "POST" ? handleVote(request, env, origin) : json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (url.pathname === "/feedback") return request.method === "POST" ? handleFeedback(request, env, origin) : json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (url.pathname === "/ratings" && request.method === "GET") return handleRatings(url, env, origin);
  if (url.pathname === "/ratings/top" && request.method === "GET") return handleTop(url, env, origin);
  return new Response("Not found", { status: 404 });
} };
