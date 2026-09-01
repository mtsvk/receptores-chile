import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("receptores analytics worker", () => {
	it("responds with health (unit style)", async () => {
		const request = new Request("http://example.com/health");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" });
	});

	it("responds with health (integration style)", async () => {
		const response = await SELF.fetch("http://example.com/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: "receptores-analytics" });
	});
});
