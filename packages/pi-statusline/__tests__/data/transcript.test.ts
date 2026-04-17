import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTranscript } from "../../src/data/transcript.js";

describe("transcript parsing", () => {
	let tmpPath: string;

	beforeEach(() => {
		tmpPath = join(tmpdir(), `transcript-${randomUUID()}.jsonl`);
	});

	afterEach(() => {
		rmSync(tmpPath, { force: true });
	});

	it("parses Claude Code format (input_tokens/output_tokens)", async () => {
		const content = [
			JSON.stringify({
				type: "user",
				message: { role: "user", usage: { input_tokens: 1000, output_tokens: 0 } },
			}),
			JSON.stringify({
				type: "assistant",
				message: { role: "assistant", usage: { input_tokens: 1000, output_tokens: 500 } },
			}),
		].join("\n");
		writeFileSync(tmpPath, content);

		const metrics = await parseTranscript(tmpPath);
		expect(metrics.tokens.inputTokens).toBe(2000);
		expect(metrics.tokens.outputTokens).toBe(500);
	});

	it("parses pi session format (input/output)", async () => {
		const content = [
			JSON.stringify({
				type: "message",
				message: { role: "assistant", usage: { input: 484, output: 49 } },
			}),
			JSON.stringify({
				type: "message",
				message: { role: "assistant", usage: { input: 96, output: 66 } },
			}),
		].join("\n");
		writeFileSync(tmpPath, content);

		const metrics = await parseTranscript(tmpPath);
		expect(metrics.tokens.inputTokens).toBe(580);
		expect(metrics.tokens.outputTokens).toBe(115);
	});

	it("extracts skill name from slash command", async () => {
		const content = [
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "/code-search find something" },
			}),
		].join("\n");
		writeFileSync(tmpPath, content);

		const metrics = await parseTranscript(tmpPath);
		expect(metrics.lastSkill).toBe("code-search");
	});

	it("extracts thinking effort from metadata", async () => {
		const content = [
			JSON.stringify({
				type: "assistant",
				metadata: { effort: "high" },
				message: { role: "assistant", content: [{ type: "text", text: "test" }] },
			}),
		].join("\n");
		writeFileSync(tmpPath, content);

		const metrics = await parseTranscript(tmpPath);
		expect(metrics.thinkingEffort).toBe("high");
	});

	it("returns zeros for empty transcript", async () => {
		writeFileSync(tmpPath, "");
		const metrics = await parseTranscript(tmpPath);
		expect(metrics.tokens.inputTokens).toBe(0);
		expect(metrics.tokens.outputTokens).toBe(0);
	});

	it("ignores invalid JSON lines", async () => {
		const content = [
			"not valid json",
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					usage: { input_tokens: 50, output_tokens: 10 },
				},
			}),
		].join("\n");
		writeFileSync(tmpPath, content);

		const metrics = await parseTranscript(tmpPath);
		expect(metrics.tokens.inputTokens).toBe(50);
		expect(metrics.tokens.outputTokens).toBe(10);
	});
});
