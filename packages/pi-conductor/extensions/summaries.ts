import { existsSync, readFileSync } from "node:fs";

type TextPart = { type?: string; text?: string };

type SessionLine = {
	type?: string;
	message?: {
		role?: string;
		content?: string | TextPart[];
	};
	content?: string | TextPart[];
};

function extractTextContent(content: string | TextPart[] | undefined): string[] {
	if (typeof content === "string") {
		return [content.trim()].filter(Boolean);
	}
	if (!Array.isArray(content)) {
		return [];
	}
	return content
		.filter((item) => item?.type === "text" && typeof item.text === "string")
		.map((item) => item.text!.trim())
		.filter(Boolean);
}

export function generateWorkerSummaryFromSession(sessionFile: string): string {
	if (!existsSync(sessionFile)) {
		throw new Error(`Session file not found: ${sessionFile}`);
	}

	const snippets = readFileSync(sessionFile, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as SessionLine)
		.flatMap((entry) => {
			if (entry.type === "message") {
				return extractTextContent(entry.message?.content);
			}
			if (entry.type === "custom_message") {
				return extractTextContent(entry.content);
			}
			return [];
		});

	if (snippets.length === 0) {
		return "Session exists but has no summarizable text yet.";
	}

	return snippets.slice(-3).join(" | ");
}
