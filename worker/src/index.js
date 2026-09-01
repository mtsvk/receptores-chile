const PROD_ORIGIN = "https://receptores.vukusic.cl";
const DEV_ORIGINS = new Set(["http://localhost:8000", "http://127.0.0.1:8000"]);
const VALID_EVENTS = new Set(["search", "receptor_open", "contact_click"]);
const VALID_CONTACT_TYPES = new Set(["telefono", "whatsapp", "email"]);
const VALID_REASONS = new Set(["rapidez", "comunicacion", "disponibilidad", "cumplimiento", "trato", "honorarios"]);
const RECEPTOR_ID = /^rec-\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/i;

function text(value, max = 250) { if (value === null || value === undefined) return null; const result = String(value).trim(); return result ? result.slice(0, max) : null; }
function integer(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null; }
function allowedOrigin(origin) { return origin === PROD_ORIGIN || DEV_ORIGINS.has(origin); }
function corsHeaders(origin, methods = "GET, POST, OPTIONS") { return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": methods, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" }; }
function json(data, status = 200, origin = PROD_ORIGIN) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } }); }
async function hmac(secret, value) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))); return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function ipOf(request) { return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "unknown"; }
async function voterKey(request, browserId, secret) { return hmac(secret, `${ipOf(request)}\n${browserId}`); }
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
function aggregate(row) { const up = Number(row?.up || 0), down = Number(row?.down || 0), total = up + down; return { up, down, total, positive_pct: total ? Math.round(up * 100 / total) : 0 }; }
function wilson(up, total) { if (!total) return 0; const z = 1.959963984540054, p = up / total, denominator = 1 + z * z / total; return (p + z * z / (2 * total) - z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)) / denominator; }
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
  if (body.vote !== 1 && body.vote !== -1) return json({ ok: false, error: "invalid_vote" }, 400, origin);
  const reasons = body.reasons === undefined ? [] : body.reasons;
  if (!Array.isArray(reasons) || reasons.length > 6 || reasons.some(reason => typeof reason !== "string" || !VALID_REASONS.has(reason))) return json({ ok: false, error: "invalid_reasons" }, 400, origin);
  const comment = body.comment === undefined || body.comment === null ? "" : String(body.comment).trim();
  if (comment.length > 300 || /[<>]/.test(comment)) return json({ ok: false, error: "invalid_comment" }, 400, origin);
  if (!env.VOTE_HMAC_SECRET) return json({ ok: false, error: "server_not_configured" }, 503, origin);
  if (!await verifyTurnstile(text(body.turnstile_token, 4096), request, env)) return json({ ok: false, error: "turnstile_failed" }, 403, origin);
  const limit = await enforceRateLimit(env.receptores_analytics_db, request, env.VOTE_HMAC_SECRET || ""); if (!limit.ok) return json({ ok: false, error: "rate_limited", retry_after: limit.retry_after }, 429, origin);
  const key = await voterKey(request, browserId, env.VOTE_HMAC_SECRET || "");
  await env.receptores_analytics_db.batch([
    env.receptores_analytics_db.prepare("INSERT INTO votes (receptor_id, voter_key, vote, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now')) ON CONFLICT(receptor_id, voter_key) DO UPDATE SET vote = excluded.vote, updated_at = datetime('now')").bind(receptorId, key, body.vote),
    env.receptores_analytics_db.prepare("INSERT INTO vote_details (receptor_id, voter_key, reasons_json, comment, moderation_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'private', datetime('now'), datetime('now')) ON CONFLICT(receptor_id, voter_key) DO UPDATE SET reasons_json = excluded.reasons_json, comment = excluded.comment, updated_at = datetime('now')").bind(receptorId, key, JSON.stringify(reasons), comment || null)
  ]);
  return json({ ok: true, receptor_id: receptorId, ...(await ratingFor(env.receptores_analytics_db, receptorId)), my_vote: body.vote }, 200, origin);
}
async function ratingFor(db, id) { return aggregate(await db.prepare("SELECT SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down FROM votes WHERE receptor_id = ?").bind(id).first()); }
async function handleRatings(url, env, origin) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(id => id.trim()).filter(Boolean))]; if (!ids.length || ids.length > 100 || ids.some(id => !RECEPTOR_ID.test(id))) return json({ ok: false, error: "invalid_ids" }, 400, origin);
  const result = await env.receptores_analytics_db.prepare(`SELECT receptor_id, SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down FROM votes WHERE receptor_id IN (${ids.map(() => "?").join(",")}) GROUP BY receptor_id`).bind(...ids).all();
  return json({ ratings: Object.fromEntries(ids.map(id => [id, aggregate(result.results.find(row => row.receptor_id === id))])) }, 200, origin);
}
async function handleTop(url, env, origin) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100) || 100));
  const result = await env.receptores_analytics_db.prepare("SELECT receptor_id, SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down FROM votes GROUP BY receptor_id").all();
  const ratings = result.results.map(row => ({ receptor_id: row.receptor_id, ...aggregate(row) })).filter(row => row.total >= 5).map(row => ({ ...row, ranking_score: wilson(row.up, row.total) })).sort((a, b) => b.ranking_score - a.ranking_score || b.total - a.total).slice(0, limit);
  return json({ ratings }, 200, origin);
}
async function handleReasons(id, env, origin) {
  if (!RECEPTOR_ID.test(id || "")) return json({ ok: false, error: "invalid_receptor_id" }, 400, origin);
  const rows = await env.receptores_analytics_db.prepare("SELECT v.vote, d.reasons_json FROM votes v JOIN vote_details d ON d.receptor_id = v.receptor_id AND d.voter_key = v.voter_key WHERE v.receptor_id = ? AND json_valid(d.reasons_json) = 1").bind(id).all();
  const reasons = Object.fromEntries([...VALID_REASONS].map(reason => [reason, { positive: 0, negative: 0 }])); for (const row of rows.results) for (const reason of JSON.parse(row.reasons_json || "[]")) if (reasons[reason]) reasons[reason][row.vote === 1 ? "positive" : "negative"] += 1;
  return json({ receptor_id: id, total_with_reasons: rows.results.length, reasons }, 200, origin);
}
export default { async fetch(request, env) {
  const url = new URL(request.url), origin = request.headers.get("Origin") || "";
  if (url.pathname === "/health" && request.method === "GET") return new Response(JSON.stringify({ ok: true, service: "receptores-analytics" }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  if (!allowedOrigin(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (url.pathname === "/event") return request.method === "POST" ? handleEvent(request, env, origin) : json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (url.pathname === "/vote") return request.method === "POST" ? handleVote(request, env, origin) : json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (url.pathname === "/ratings" && request.method === "GET") return handleRatings(url, env, origin);
  if (url.pathname === "/ratings/top" && request.method === "GET") return handleTop(url, env, origin);
  const match = url.pathname.match(/^\/ratings\/(rec-[^/]+)\/reasons$/); if (match && request.method === "GET") return handleReasons(match[1], env, origin);
  return new Response("Not found", { status: 404 });
} };
