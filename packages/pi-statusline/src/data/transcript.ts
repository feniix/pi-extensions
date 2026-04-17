/**
 * Transcript (.jsonl) parser for token counts, thinking effort, and skills.
 *
 * Supports both Claude Code and pi session file formats.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { ThinkingEffort, TranscriptMetrics } from "../types.js";

/** Parse a single JSONL line into an object, or null on failure. */
function parseLine(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

/** Normalize a thinking effort string to a known level. */
function normalizeThinkingEffort(value: unknown): ThinkingEffort | null {
	if (typeof value !== "string") return null;
	const lower = value.toLowerCase();
	if (lower === "low" || lower === "medium" || lower === "high" || lower === "max") {
		return lower as ThinkingEffort;
	}
	return null;
}

/** Look for a skill name at the start of a prompt string. */
function extractSkillFromPrompt(prompt: unknown): string | null {
	if (typeof prompt !== "string") return null;
	const match = /^\/([a-zA-Z0-9_-]+)/.exec(prompt);
	return match?.[1] ?? null;
}

/** Look for a skill name from a Skill tool invocation. */
function extractSkillFromToolInput(input: unknown): string | null {
	if (typeof input !== "object" || input === null) return null;
	const obj = input as Record<string, unknown>;
	if (typeof obj.skill === "string" && obj.skill.length > 0) {
		return obj.skill;
	}
	return null;
}

/**
 * Accumulate token counts from a usage object.
 * Handles both Claude Code format (input_tokens / output_tokens) and
 * pi session format (input / output).
 */
function accumulateUsage(
	usage: Record<string, unknown> | undefined,
	inputAcc: { value: number },
	outputAcc: { value: number },
): void {
	if (!usage) return;
	// Claude Code: input_tokens / output_tokens
	// pi session: input / output
	const input = (usage.input_tokens ?? usage.input) as number | undefined;
	const output = (usage.output_tokens ?? usage.output) as number | undefined;
	if (typeof input === "number") inputAcc.value += input;
	if (typeof output === "number") outputAcc.value += output;
}

/**
 * Parse a transcript .jsonl file and return token metrics, thinking effort,
 * and the last skill invoked.
 *
 * Supports both Claude Code and pi session file formats.
 */
export async function parseTranscript(path: string): Promise<TranscriptMetrics> {
	const inputAcc = { value: 0 };
	const outputAcc = { value: 0 };
	let thinkingEffort: ThinkingEffort | null = null;
	let lastSkill: string | null = null;

	const rl = createInterface({
		input: createReadStream(path),
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	for await (const line of rl) {
		const data = parseLine(line);
		if (!data) continue;

		const type = typeof data.type === "string" ? data.type : null;
		const message = data.message as Record<string, unknown> | undefined;

		// Determine role: pi uses message.role, Claude Code uses type
		const role = typeof message?.role === "string" ? message.role : null;

		// Accumulate token usage from assistant/user messages
		if (type === "assistant" || type === "assistant_turn" || role === "assistant") {
			accumulateUsage(message?.usage as Record<string, unknown> | undefined, inputAcc, outputAcc);
		}

		if (type === "user" || type === "user_turn" || role === "user") {
			accumulateUsage(message?.usage as Record<string, unknown> | undefined, inputAcc, outputAcc);
		}

		// Extract thinking effort from metadata
		if (thinkingEffort === null) {
			const meta = data.metadata as Record<string, unknown> | undefined;
			if (meta) {
				thinkingEffort = normalizeThinkingEffort(meta.effort ?? meta.thinking_effort);
			}
			if (thinkingEffort === null) {
				thinkingEffort = normalizeThinkingEffort(data.effort ?? data.thinking_effort);
			}
		}

		// Extract skill from user prompts (slash commands)
		if (type === "user" || type === "user_turn") {
			const prompt = (data.message as Record<string, unknown>)?.content ?? data.content;
			const skill = extractSkillFromPrompt(prompt);
			if (skill) lastSkill = skill;
		}

		// Extract skill from Skill tool calls
		if (data.tool_name === "Skill" || data.tool_name === "skill") {
			const skill = extractSkillFromToolInput(data.tool_input);
			if (skill) lastSkill = skill;
		}
	}

	rl.close();

	return {
		tokens: {
			inputTokens: inputAcc.value,
			outputTokens: outputAcc.value,
			totalTokens: inputAcc.value + outputAcc.value,
		},
		thinkingEffort,
		lastSkill,
	};
}
