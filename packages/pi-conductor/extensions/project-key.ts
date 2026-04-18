import { createHash } from "node:crypto";
import { resolve } from "node:path";

function sanitizeSegment(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "") || "repo";
}

export function deriveProjectKey(repoRoot: string): string {
	const normalized = resolve(repoRoot);
	const flattened = normalized.replace(/[/:\\]/g, "-");
	const slug = sanitizeSegment(flattened);
	const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 10);
	return `${slug}-${hash}`;
}
