/** ANSI escape to reset all styles */
export const RESET = "\x1b[0m";

/** Wrap text in a color using ANSI codes (no trailing reset) */
function color(code: number, text: string): string {
	return `\x1b[38;5;${code}m${text}`;
}

/** Color aliases matching ccstatusline's named colors */
export const C = {
	cyan: (text: string) => color(14, text),
	magenta: (text: string) => color(13, text),
	blue: (text: string) => color(12, text),
	yellow: (text: string) => color(11, text),
	brightBlack: (text: string) => color(8, text),
	green: (text: string) => color(10, text),
	bold: (text: string) => `\x1b[1m${text}${RESET}`,
};

const SEPARATOR = " | ";

/** Join widget segments with the standard separator, resetting color between each */
export function joinWidgets(...segments: string[]): string {
	if (segments.length === 0) return "";
	return segments.join(`${RESET}${SEPARATOR}`);
}

/**
 * Format a token count into a compact human-readable string.
 * e.g. 1200 → "1.2k", 1_500_000 → "1.5M"
 */
export function formatTokenCount(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 1_000_000) {
		const k = n / 1000;
		return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
	}
	const m = n / 1_000_000;
	return `${m.toFixed(1)}M`;
}

/**
 * Format input/output token pair with arrows.
 * e.g. { input: 10500, output: 3200 } → "↑10.5k/↓3.2k"
 */
export function formatTokenPair(input: number, output: number): string {
	return `↑${formatTokenCount(input)}/↓${formatTokenCount(output)}`;
}

/**
 * Format context percentage to one decimal place.
 * e.g. 11.023 → "11.0", 9.5 → "9.5"
 */
export function formatContextPct(pct: number | null): string {
	if (pct === null) return "?";
	return `${pct.toFixed(1)}`;
}
