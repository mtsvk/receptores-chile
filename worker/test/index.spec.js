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
		if (this.sql.includes("INSERT INTO private_feedback")) this.db.feedback.set(`${this.args[0]}|${this.args[1]}`, { receptor_id: this.args[0], voter_key: this.args[1], reasons_json: this.args[2], comment: this.args[3] });
		if (this.sql.includes("WHERE count < 5")) { const key = this.args[0]; const count = this.db.rateLimits.get(key) || 0; if (count < 5) { this.db.rateLimits.set(key, count + 1); return { success: true, meta: { changes: 1 } }; } return { success: true, meta: { changes: 0 } }; }
		return { success: true };
	}
	async first() { if (this.sql.includes("COUNT(*) AS recommendations")) return { recommendations: [...this.db.votes.values()].filter(row => row.receptor_id === this.args[0] && row.vote === 1).length }; if (this.sql.includes("SELECT vote FROM votes")) return this.db.votes.get(`${this.args[0]}|${this.args[1]}`) || null; if (this.sql.includes("SELECT count FROM vote_rate_limits")) return { count: this.db.rateLimits.get(this.args[0]) || 0 }; return null; }
	async all() { return { results: this.group(this.sql.includes("receptor_id IN") ? this.args : null) }; }
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
function testEnv(db) { return { receptores_analytics_db: db, VOTE_HMAC_SECRET: "test-hmac-secret", TURNSTILE_SECRET_KEY: "test-turnstile-secret" }; }
async function request(db, path, body, ip = "192.0.2.1") {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`https://example.com${path}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), testEnv(db), ctx);
	await waitOnExecutionContext(ctx); return response;
}
function validBrowserId(value) { return String(value).padEnd(16, "x"); }
function voteBody(browser_id, vote = 1) { return { receptor_id: RECEPTOR, browser_id: validBrowserId(browser_id), vote, turnstile_token: "valid-token" }; }
async function recommend(db, browser_id, ip = "192.0.2.1") { return request(db, "/vote", voteBody(browser_id), ip); }
async function publicRatings(db) { return worker.fetch(new Request(`https://example.com/ratings?ids=${RECEPTOR}`, { headers: { Origin: ORIGIN } }), testEnv(db), createExecutionContext()); }

describe("receptores analytics worker", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("responds with health (unit style)", async () => {
		const ctx = createExecutionContext(); const response = await worker.fetch(new Request("http://example.com/health"), env, ctx); await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" });
	});
	it("responds with health (integration style)", async () => { const response = await SELF.fetch("http://example.com/health"); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" }); });
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
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		const response = await request(db, "/feedback", { receptor_id: RECEPTOR, browser_id: validBrowserId("browser-alpha"), turnstile_token: "valid-token", reasons: ["trato"], comment: "Comentario privado" });
		expect(response.status).toBe(201); expect(db.feedback.size).toBe(1); expect(await (await publicRatings(db)).json()).toEqual({ ratings: { [RECEPTOR]: { recommendations: 0 } } });
		expect(JSON.stringify(await response.clone().json())).not.toContain("Comentario privado");
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
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 })); const db = new MockDb();
		expect((await request(db, "/feedback", { receptor_id: RECEPTOR, browser_id: validBrowserId("feedback"), turnstile_token: "valid-token", reasons: ["trato"], comment: "Privado" })).status).toBe(201);
		for (let i = 0; i < 5; i++) expect((await recommend(db, `browser-${i}`)).status).toBe(200);
	});
	it("uses America/Santiago for the daily bucket", () => {
		expect(chileDateKey(new Date("2026-07-15T03:30:00Z"))).toBe("2026-07-14");
		expect(chileDateKey(new Date("2026-07-15T04:30:00Z"))).toBe("2026-07-15");
	});
});
