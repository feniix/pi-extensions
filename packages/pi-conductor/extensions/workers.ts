function collapseDashes(value: string): string {
	return value.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeWorkerSlug(name: string): string | null {
	const normalized = collapseDashes(
		name
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9._-]+/g, "-"),
	);
	return normalized.length > 0 ? normalized : null;
}

export function buildBranchName(workerId: string, name: string): string {
	const slug = normalizeWorkerSlug(name);
	return `conductor/${slug ?? workerId}`;
}

export function createWorkerId(): string {
	const random = Math.random().toString(36).slice(2, 10);
	return `worker-${Date.now().toString(36)}-${random}`;
}
