import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { chileDateKey } from "../src";

const ORIGIN = "http://localhost:8000";
const RECEPTOR = "rec-0001-demo";

class MockStatement {
	constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
	bind(...args) { this.args = args; return this; }
	async run() {
		if (this.sql.includes("INSERT INTO votes")) this.db.votes.set(`${this.args[0]}|${this.args[1]}`, { receptor_id: this.args[0], voter_key: this.args[1], vote: 1 });
		if (this.sql.includes("UPDATE votes")) { const row = this.db.votes.get(`${this.args[0]}|${this.args[1]}`); if (row) row.vote = 1; }
		if (this.sql.includes("INSERT INTO private_feedback")) this.db.feedback.set(`${this.args[0]}|${this.args[1]}`, { receptor_id: this.args[0], voter_key: this.args[1], reasons_json: this.args[2], comment: this.args[3], publication_status: this.args[4] === 1 ? "pending" : "not_requested", publication_consent_at: this.args[4] === 1 ? "now" : null, published_at: null });
		if (this.sql.includes("WHERE count < 5")) { const key = this.args[0]; const count = this.db.rateLimits.get(key) || 0; if (count < 5) { this.db.rateLimits.set(key, count + 1); return { success: true, meta: { changes: 1 } }; } return { success: true, meta: { changes: 0 } }; }
		return { success: true };
	}
	async first() { if (this.sql.includes("COUNT(*) AS recommendations")) return { recommendations: [...this.db.votes.values()].filter(row => row.receptor_id === this.args[0] && row.vote === 1).length }; if (this.sql.includes("SELECT vote FROM votes")) return this.db.votes.get(`${this.args[0]}|${this.args[1]}`) || null; if (this.sql.includes("SELECT count FROM vote_rate_limits")) return { count: this.db.rateLimits.get(this.args[0]) || 0 }; return null; }
	async all() { if (this.sql.includes("publication_status = 'approved'")) return { results: [...this.db.feedback.values()].filter(row => row.receptor_id === this.args[0] && row.publication_status === "approved" && row.comment).map(row => ({ reasons_json: row.reasons_json, comment: row.comment, published_at: row.published_at })) }; return { results: this.group(this.sql.includes("receptor_id IN") ? this.args : null) }; }
	group(ids = null) {
		const rows = [...this.db.votes.values()].filter(row => row.vote === 1 && (!ids || ids.includes(row.receptor_id)));
		const counts = new Map(); for (const row of rows) counts.set(row.receptor_id, (counts.get(row.receptor_id) || 0) + 1);
		return [...counts].map(([receptor_id, recommendations]) => ({ receptor_id, recommendations }));
	}
}
class MockDb {
	votes = new Map(); feedback = new Map(); rateLimits = new Map();
	prepare(sql) { return new MockStatement(this, sql); }
	async batch(statements) {
		if (statements[0]?.sql.includes("SELECT count FROM vote_rate_limits")) return statements.map(statement => ({ results: [{ count: this.rateLimits.get(statement.args[0]) || 0 }] }));
		for (const statement of statements) if (statement.sql.includes("INSERT INTO vote_rate_limits")) this.rateLimits.set(statement.args[0], (this.rateLimits.get(statement.args[0]) || 0) + 1);
		return statements.map(() => ({ success: true }));
	}
}
function testEnv(db) { return { receptores_analytics_db: db, VOTE_HMAC_SECRET: "test-hmac-secret", TURNSTILE_SECRET_KEY: "test-turnstile-secret", GOOGLE_CLIENT_ID: "google-client-id" }; }
function whatsappEnv() { return { WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token", WHATSAPP_APP_SECRET: "app-secret", VOTE_HMAC_SECRET: "test-hmac-secret" }; }
async function signature(secret, body) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
	return `sha256=${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function whatsappRequest(method, url, body, headers = {}) {
	const requestHeaders = { ...headers };
	if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
	return worker.fetch(new Request(`https://example.com${url}`, { method, headers: requestHeaders, body }), whatsappEnv(), createExecutionContext());
}
async function request(db, path, body, ip = "192.0.2.1") {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`https://example.com${path}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), testEnv(db), ctx);
	await waitOnExecutionContext(ctx); return response;
}
function validBrowserId(value) { return String(value).padEnd(16, "x"); }
function voteBody(browser_id, vote = 1) { return { receptor_id: RECEPTOR, browser_id: validBrowserId(browser_id), vote, turnstile_token: "valid-token" }; }
async function recommend(db, browser_id, ip = "192.0.2.1") { return request(db, "/vote", voteBody(browser_id), ip); }
async function publicRatings(db) { return worker.fetch(new Request(`https://example.com/ratings?ids=${RECEPTOR}`, { headers: { Origin: ORIGIN } }), testEnv(db), createExecutionContext()); }
async function makeGoogleToken(overrides = {}, headerOverrides = {}) {
	const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
	const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey), header = { alg: "RS256", kid: "test-key", typ: "JWT", ...headerOverrides }, claims = { iss: "https://accounts.google.com", aud: "google-client-id", sub: "google-sub-123", exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
	const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""), unsigned = `${encode(header)}.${encode(claims)}`;
	const signatureBytes = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned)));
	return { token: `${unsigned}.${btoa(String.fromCharCode(...signatureBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`, jwks: { keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] } };
}
function stubGoogleFetch(jwks) { vi.stubGlobal("fetch", async url => String(url).includes("googleapis.com/oauth2") ? new Response(JSON.stringify(jwks), { status: 200 }) : new Response(JSON.stringify({ success: true }), { status: 200 })); }
function feedbackBody(google_credential, extra = {}) { return { receptor_id: RECEPTOR, browser_id: validBrowserId("feedback"), turnstile_token: "valid-token", google_credential, reasons: ["trato"], comment: "Privado", ...extra }; }
async function comments(db, receptorId = RECEPTOR) { return worker.fetch(new Request(`https://example.com/comments?receptor_id=${encodeURIComponent(receptorId)}`, { headers: { Origin: ORIGIN } }), testEnv(db), createExecutionContext()); }

describe("receptores analytics worker", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("responds with health (unit style)", async () => {
		const ctx = createExecutionContext(); const response = await worker.fetch(new Request("http://example.com/health"), env, ctx); await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" });
	});
	it("responds with health (integration style)", async () => { const response = await SELF.fetch("http://example.com/health"); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" }); });
	it("verifies the WhatsApp webhook GET challenge", async () => {
		const response = await whatsappRequest("GET", "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123");
		expect(response.status).toBe(200); expect(await response.text()).toBe("challenge-123");
	});
	it("rejects an invalid WhatsApp webhook GET challenge", async () => {
		const response = await whatsappRequest("GET", "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123");
		expect(response.status).toBe(403);
	});
	it("accepts a valid WhatsApp webhook POST signature", async () => {
		const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "56912345678", id: "wamid.TEST", text: { body: "Hola" } }] } }] }] });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = await whatsappRequest("POST", "/whatsapp/webhook", body, { "X-Hub-Signature-256": await signature("app-secret", body) });
		expect(response.status).toBe(200); expect(log).toHaveBeenCalledWith("whatsapp_message", expect.objectContaining({ message_id: "wamid.TEST" })); expect(log.mock.calls.flat().join(" ")).not.toContain("56912345678"); expect(log.mock.calls.flat().join(" ")).not.toContain("Hola");
	});
	it("rejects an invalid WhatsApp webhook POST signature", async () => {
		const body = JSON.stringify({ entry: [] }); const response = await whatsappRequest("POST", "/whatsapp/webhook", body, { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) });
		expect(response.status).toBe(401);
	});
	it("accepts a valid WhatsApp payload without messages", async () => {
		const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] }); const response = await whatsappRequest("POST", "/whatsapp/webhook", body, { "X-Hub-Signature-256": await signature("app-secret", body) });
		expect(response.status).toBe(200);
	});
	it("rejects feedback without Google credential", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const response = await request(new MockDb(), "/feedback", { receptor_id: RECEPTOR, browser_id: validBrowserId("no-google"), turnstile_token: "valid-token", reasons: [], comment: "" });
		expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, error: "google_verification_required" });
	});
	it("rejects feedback when GOOGLE_CLIENT_ID is absent", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb(), google = await makeGoogleToken(); const response = await worker.fetch(new Request("https://example.com/feedback", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" }, body: JSON.stringify(feedbackBody(google.token)) }), { ...testEnv(db), GOOGLE_CLIENT_ID: "" }, createExecutionContext());
		expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: "server_not_configured" });
	});
	it("accepts feedback with a valid Google credential and Turnstile", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb(); const response = await request(db, "/feedback", feedbackBody(google.token));
		expect(response.status).toBe(201); expect(db.feedback.size).toBe(1);
	});
	it.each([["audience", { aud: "other-client" }], ["issuer", { iss: "https://accounts.example.com" }], ["expiration", { exp: Math.floor(Date.now() / 1000) - 1 }], ["sub", { sub: "" }]])("rejects Google token with invalid %s", async (_, claims) => {
		const google = await makeGoogleToken(claims); stubGoogleFetch(google.jwks); const response = await request(new MockDb(), "/feedback", feedbackBody(google.token)); expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, error: "google_verification_required" });
	});
	it("rejects a JWT payload modified without resigning", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const parts = google.token.split("."); parts[1] = btoa(JSON.stringify({ iss: "https://accounts.google.com", aud: "google-client-id", sub: "altered-sub", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); const response = await request(new MockDb(), "/feedback", feedbackBody(parts.join("."))); expect(response.status).toBe(403);
	});
	it("rejects a JWT with an algorithm other than RS256", async () => {
		const google = await makeGoogleToken({}, { alg: "HS256" }); stubGoogleFetch(google.jwks); const response = await request(new MockDb(), "/feedback", feedbackBody(google.token)); expect(response.status).toBe(403);
	});
	it("uses Google sub as feedback identity per receptor", async () => {
		const first = await makeGoogleToken({ sub: "google-sub-one" }); stubGoogleFetch(first.jwks); const db = new MockDb(); expect((await request(db, "/feedback", feedbackBody(first.token, { comment: "Primero" }))).status).toBe(201); expect((await request(db, "/feedback", feedbackBody(first.token, { comment: "Reemplazo" }))).status).toBe(201); expect(db.feedback.size).toBe(1); expect([...db.feedback.values()][0].comment).toBe("Reemplazo");
		const second = await makeGoogleToken({ sub: "google-sub-two" }); stubGoogleFetch(second.jwks); expect((await request(db, "/feedback", feedbackBody(second.token, { comment: "Segundo" }))).status).toBe(201); expect(db.feedback.size).toBe(2);
	});
	it("does not store or log Google data", async () => {
		const google = await makeGoogleToken({ sub: "private-sub", email: "private@example.com" }); stubGoogleFetch(google.jwks); const db = new MockDb(); const log = vi.spyOn(console, "log").mockImplementation(() => {}); log.mockClear(); await request(db, "/feedback", feedbackBody(google.token)); const row = [...db.feedback.values()][0], stored = JSON.stringify(row); expect(stored).not.toContain("private-sub"); expect(stored).not.toContain("private@example.com"); expect(stored).not.toContain(google.token); expect(log).not.toHaveBeenCalled();
	});
	it("keeps the feedback IP rate limit", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb(); for (let i = 0; i < 20; i++) expect((await request(db, "/feedback", feedbackBody(google.token, { comment: `c${i}` }))).status).toBe(201); expect((await request(db, "/feedback", feedbackBody(google.token))).status).toBe(429);
	});
	it("uses browser identity across IP changes and different browsers remain distinct", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		expect((await recommend(db, "browser-alpha", "192.0.2.1")).status).toBe(200);
		expect(await (await recommend(db, "browser-alpha", "198.51.100.1")).json()).toMatchObject({ recommendations: 1 });
		expect(await (await recommend(db, "browser-beta", "198.51.100.1")).json()).toMatchObject({ recommendations: 2 });
	});
	it("repeating a recommendation is idempotent and does not reduce remaining", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		expect((await (await recommend(db, "browser-alpha")).json()).recommendations_remaining_today).toBe(4);
		expect(await (await recommend(db, "browser-alpha")).json()).toMatchObject({ recommendations: 1, recommendations_remaining_today: 4 });
	});
	it("rejects vote=-1", async () => { const response = await request(new MockDb(), "/vote", voteBody("browser-alpha", -1)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "invalid_vote" }); });
	it("private feedback does not increase recommendations or appear publicly", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb();
		const response = await request(db, "/feedback", feedbackBody(google.token, { browser_id: validBrowserId("browser-alpha"), comment: "Comentario privado" }));
		expect(response.status).toBe(201); expect(db.feedback.size).toBe(1); expect(await (await publicRatings(db)).json()).toEqual({ ratings: { [RECEPTOR]: { recommendations: 0 } } });
		expect(JSON.stringify(await response.clone().json())).not.toContain("Comentario privado");
	});
	it("feedback publication requires explicit opt-in and starts pending", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb();
		expect((await request(db, "/feedback", feedbackBody(google.token))).status).toBe(201);
		expect([...db.feedback.values()][0].publication_status).toBe("not_requested");
		expect((await request(db, "/feedback", feedbackBody(google.token, { allow_publication: true, comment: "Experiencia concreta" }))).status).toBe(201);
		expect([...db.feedback.values()][0].publication_status).toBe("pending");
	});
	it("public comments expose only approved feedback", async () => {
		const db = new MockDb(); db.feedback.set("approved", { receptor_id: RECEPTOR, voter_key: "secret-voter-key", reasons_json: '["rapidez","<script>alert(1)</script>"]', comment: "Comentario aprobado", publication_status: "approved", published_at: "2026-09-01 12:00:00" });
		for (const status of ["pending", "rejected", "not_requested"]) db.feedback.set(status, { receptor_id: RECEPTOR, voter_key: status, reasons_json: '["trato"]', comment: status, publication_status: status, published_at: null });
		const response = await comments(db); expect(response.status).toBe(200); const body = await response.json();
		expect(body).toEqual({ comments: [{ reasons: ["rapidez"], comment: "Comentario aprobado", published_at: "2026-09-01 12:00:00" }] });
		expect(JSON.stringify(body)).not.toContain("secret-voter-key");
	});
	it("editing approved feedback returns to pending, and opting out removes publication", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb();
		expect((await request(db, "/feedback", feedbackBody(google.token, { allow_publication: true, comment: "Anterior" }))).status).toBe(201);
		[...db.feedback.values()][0].publication_status = "approved";
		expect((await request(db, "/feedback", feedbackBody(google.token, { allow_publication: true, comment: "Editado" }))).status).toBe(201);
		expect([...db.feedback.values()][0].publication_status).toBe("pending");
		expect((await request(db, "/feedback", feedbackBody(google.token, { allow_publication: false, comment: "Privado otra vez" }))).status).toBe(201);
		expect([...db.feedback.values()][0].publication_status).toBe("not_requested");
	});
	it("rejects an opted-in empty public comment", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const response = await request(new MockDb(), "/feedback", feedbackBody(google.token, { allow_publication: true, comment: "" }));
		expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "public_comment_requires_text" });
	});
	it("rejects invalid public comment receptor ids", async () => {
		const response = await comments(new MockDb(), "not-a-receptor"); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "invalid_receptor_id" });
	});
	it("requires Turnstile for feedback publication", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false }), { status: 200 })); const google = await makeGoogleToken(); const response = await request(new MockDb(), "/feedback", feedbackBody(google.token, { allow_publication: true }));
		expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, error: "turnstile_failed" });
	});
	it("public endpoints expose only recommendations and ranking requires five", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		for (let i = 0; i < 4; i++) await recommend(db, `browser-${i}`);
		expect(await (await publicRatings(db)).json()).toEqual({ ratings: { [RECEPTOR]: { recommendations: 4 } } });
		let top = await worker.fetch(new Request("https://example.com/ratings/top", { headers: { Origin: ORIGIN } }), testEnv(db), createExecutionContext()); expect(await top.json()).toEqual({ ratings: [] });
		await recommend(db, "browser-4"); top = await worker.fetch(new Request("https://example.com/ratings/top", { headers: { Origin: ORIGIN } }), testEnv(db), createExecutionContext()); const body = await top.json();
		expect(body.ratings[0]).toMatchObject({ receptor_id: RECEPTOR, recommendations: 5 }); expect(body.ratings[0]).not.toHaveProperty("down"); expect(body.ratings[0]).not.toHaveProperty("positive_pct");
	});
	it("limits five new recommendations per day and IP", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		for (let i = 0; i < 5; i++) { const response = await recommend(db, `browser-${i}`); expect(response.status).toBe(200); expect((await response.json()).recommendations_remaining_today).toBe(4 - i); }
		const limited = await recommend(db, "browser-5"); expect(limited.status).toBe(429); expect(await limited.json()).toEqual({ ok: false, error: "daily_recommendation_limit", limit: 5 });
	});
	it("idempotent repeats do not consume the daily quota", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		for (let i = 0; i < 4; i++) await recommend(db, `browser-${i}`);
		expect((await recommend(db, "browser-0")).status).toBe(200);
		expect((await recommend(db, "browser-4")).status).toBe(200);
		expect((await recommend(db, "browser-5")).status).toBe(429);
	});
	it("different browsers share the IP quota and different IPs do not", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		for (let i = 0; i < 5; i++) expect((await recommend(db, `browser-${i}`, "192.0.2.1")).status).toBe(200);
		expect((await recommend(db, "browser-other", "192.0.2.1")).status).toBe(429);
		expect((await recommend(db, "browser-other", "198.51.100.1")).status).toBe(200);
	});
	it("private feedback does not consume recommendation quota", async () => {
		const google = await makeGoogleToken(); stubGoogleFetch(google.jwks); const db = new MockDb();
		expect((await request(db, "/feedback", feedbackBody(google.token))).status).toBe(201);
		for (let i = 0; i < 5; i++) expect((await recommend(db, `browser-${i}`)).status).toBe(200);
	});
	it("uses America/Santiago for the daily bucket", () => {
		expect(chileDateKey(new Date("2026-07-15T03:30:00Z"))).toBe("2026-07-14");
		expect(chileDateKey(new Date("2026-07-15T04:30:00Z"))).toBe("2026-07-15");
	});
});
