// src/accent.ts — session-accent colorizer (Option A, approved 2026-09-09):
// the 4 row glyphs + `zai` + money labels take omp's per-session accent; every
// value keeps its semantic theme token.
//
// The algorithm is a faithful port of oh-my-pi's
// packages/coding-agent/src/utils/session-color.ts (getSessionAccentHex) +
// packages/utils/src/color.ts OKLCH helpers (both Apache-2.0, can1357/oh-my-pi).
// Why a port: omp ships as a compiled binary — the module isn't importable from
// an extension, and the plugins tree carries the upstream @earendil-works SDK
// that lacks it. Drift guard: golden-vector tests in test/accent.test.ts pin
// name→hex outputs; if upstream tunes the algorithm, those vectors plus a live
// side-by-side tell us to re-port. Long-term: upstream exposure of the accent
// to extensions deletes this file.
// Output is always truecolor SGR (38;2) with fg-only reset (39) — the widget
// runs inside omp's TUI where the native accent itself emits 16m color
// (Bun.color ansi-16m on truecolor terminals, RECTOR's Ghostty included);
// a 256-color downsample would just fork the color a second way.

// ── sRGB ↔ OKLab/OKLCH (port of @oh-my-pi/pi-utils color.ts) ────────────────

interface RGB { r: number; g: number; b: number }
interface OKLCH { l: number; c: number; h: number }

function hexToRgb(hex: string): RGB {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
	if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: NaN, g: NaN, b: NaN };
	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
	};
}

function linearizeChannel(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function delinearizeChannel(linear: number): number {
	const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.round(c * 255);
}

function rgbToHex({ r, g, b }: RGB): string {
	return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function linearRgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	};
}

function oklabToLinearRgb(L: number, a: number, b: number): RGB {
	return {
		r: 4.0767416621 * (L + 0.3963377774 * a + 0.2158037573 * b) ** 3 -
			3.3077115913 * (L - 0.1055613458 * a - 0.0638541728 * b) ** 3 -
			0.2309699292 * (L - 0.0894841775 * a - 1.291485548 * b) ** 3,
		g: -1.2684380046 * (L + 0.3963377774 * a + 0.2158037573 * b) ** 3 +
			2.6097574011 * (L - 0.1055613458 * a - 0.0638541728 * b) ** 3 -
			0.3413193965 * (L - 0.0894841775 * a - 1.291485548 * b) ** 3,
		b: -0.0041960863 * (L + 0.3963377774 * a + 0.2158037573 * b) ** 3 -
			0.7034186147 * (L - 0.1055613458 * a - 0.0638541728 * b) ** 3 +
			1.707614701 * (L - 0.0894841775 * a - 1.291485548 * b) ** 3,
	};
}

export function hexToOklch(hex: string): OKLCH {
	const rgb = hexToRgb(hex);
	const lab = linearRgbToOklab(linearizeChannel(rgb.r), linearizeChannel(rgb.g), linearizeChannel(rgb.b));
	const c = Math.hypot(lab.a, lab.b);
	let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
	if (h < 0) h += 360;
	return { l: lab.L, c, h };
}

/** Max OKLab saturation (C/L) inside sRGB for hue direction (a,b) — Ottosson's fit + one Halley step. */
function computeMaxSaturation(a: number, b: number): number {
	let k0: number, k1: number, k2: number, k3: number, k4: number, wl: number, wm: number, ws: number;
	if (-1.88170328 * a - 0.80936493 * b > 1) {
		k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
		wl = 4.0767416621; wm = -3.3077115913; ws = 0.2309699292;
	} else if (1.81444104 * a - 1.19445276 * b > 1) {
		k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.1254107; k4 = 0.14503204;
		wl = -1.2684380046; wm = 2.6097574011; ws = -0.3413193965;
	} else {
		k0 = 1.35733652; k1 = -0.00915799; k2 = -1.1513021; k3 = -0.50559606; k4 = 0.00692167;
		wl = -0.0041960863; wm = -0.7034186147; ws = -1.1513021;
	}
	const S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
	const kl = 0.3963377774 * a + 0.2158037573 * b;
	const km = -0.1055613458 * a - 0.0638541728 * b;
	const ks = -0.0894841775 * a - 1.291485548 * b;
	const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks;
	const f = wl * l_ ** 3 + wm * m_ ** 3 + ws * s_ ** 3;
	const f1 = wl * 3 * kl * l_ * l_ + wm * 3 * km * m_ * m_ + ws * 3 * ks * s_ * s_;
	const f2 = wl * 6 * kl * kl * l_ + wm * 6 * km * km * m_ + ws * 6 * ks * ks * s_;
	return S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
}

/** sRGB gamut cusp for an OKLCH hue: the (l, c) where the hue peaks in chroma. */
export function oklchCusp(h: number): { l: number; c: number } {
	const hRad = (h * Math.PI) / 180;
	const a = Math.cos(hRad), b = Math.sin(hRad);
	const sCusp = computeMaxSaturation(a, b);
	const rgb = oklabToLinearRgb(1, sCusp * a, sCusp * b);
	const lCusp = Math.cbrt(1 / Math.max(rgb.r, rgb.g, rgb.b));
	return { l: lCusp, c: lCusp * sCusp };
}

const GAMUT_EPSILON = 1e-4;

function inSrgbGamut(rgb: RGB): boolean {
	return rgb.r >= -GAMUT_EPSILON && rgb.r <= 1 + GAMUT_EPSILON &&
		rgb.g >= -GAMUT_EPSILON && rgb.g <= 1 + GAMUT_EPSILON &&
		rgb.b >= -GAMUT_EPSILON && rgb.b <= 1 + GAMUT_EPSILON;
}

/** OKLCH → hex with CSS-Color-4-style gamut mapping (chroma bisection, l/h kept). */
export function oklchToHex(oklch: OKLCH): string {
	const l = Math.max(0, Math.min(1, oklch.l));
	const hRad = (oklch.h * Math.PI) / 180;
	const cos = Math.cos(hRad), sin = Math.sin(hRad);
	const at = (c: number) => oklabToLinearRgb(l, c * cos, c * sin);
	let rgb = at(oklch.c);
	if (!inSrgbGamut(rgb)) {
		let lo = 0, hi = oklch.c;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (inSrgbGamut(at(mid))) lo = mid;
			else hi = mid;
		}
		rgb = at(lo);
	}
	return rgbToHex({
		r: Math.max(0, Math.min(255, delinearizeChannel(rgb.r))),
		g: Math.max(0, Math.min(255, delinearizeChannel(rgb.g))),
		b: Math.max(0, Math.min(255, delinearizeChannel(rgb.b))),
	});
}

function relativeLuminance(hex: string): number {
	const rgb = hexToRgb(hex);
	return 0.2126 * linearizeChannel(rgb.r) + 0.7152 * linearizeChannel(rgb.g) + 0.0722 * linearizeChannel(rgb.b);
}

// ── session accent (port of oh-my-pi utils/session-color.ts) ────────────────

/** Theme-derived inputs; mirrors omp's `Theme.sessionAccentInputs` getter. */
export interface SessionAccentInputs {
	/** Theme accent hex — the session accent adopts its OKLCH lightness/chroma. */
	accentHex: string;
	/** Major theme color hexes the accent hue must not collide with. */
	colorHexes: string[];
	/** Status-line surface luminance on light themes; undefined on dark themes. */
	surfaceLuminance?: number;
}

/** Stable djb2 32-bit hash (UTF-16 code units) — identical to upstream. */
export function nameToHash(name: string): number {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
		hash = hash >>> 0;
	}
	return hash;
}

const FALLBACK_CUSP_CHROMA_FRACTION = 0.7;
const MIN_CHROMA = 0.05;
const MAX_CHROMA = 0.21;
const DARK_MIN_LIGHTNESS = 0.65;
const DARK_MAX_LIGHTNESS = 0.88;
const ACCENT_MIN_CONTRAST = 3;
const MIN_HUE_DISTANCE = 10;
const MIN_CHROMA_FOR_HUE = 0.03;

function accentLuminanceCap(surfaceLuminance: number): number {
	return Math.max(0, (surfaceLuminance + 0.05) / ACCENT_MIN_CONTRAST - 0.05);
}

function hueDistance(a: number, b: number): number {
	const d = Math.abs(a - b);
	return Math.min(d, 360 - d);
}

function hexToHue(hex: string): number | undefined {
	const { c, h } = hexToOklch(hex);
	if (!Number.isFinite(h) || c < MIN_CHROMA_FOR_HUE) return undefined;
	return h;
}

type HueInterval = readonly [number, number];

function arcLength(intervals: readonly HueInterval[]): number {
	let n = 0;
	for (const [a, b] of intervals) n += b - a + 1;
	return n;
}

function arcToHue(intervals: readonly HueInterval[], pos: number): number {
	let p = pos;
	for (const [a, b] of intervals) {
		const n = b - a + 1;
		if (p < n) return a + p;
		p -= n;
	}
	return intervals[intervals.length - 1]?.[1] ?? 0;
}

/**
 * Dark themes draw from the full hue wheel minus hues whose sRGB gamut cusp
 * needs more lightness than the dark cap (excludes the yellow/chartreuse core
 * and the over-light cyan peak). Recomputed lazily — oklchCusp is pure.
 */
const DARK_HUE_INTERVALS: readonly HueInterval[] = (() => {
	const intervals: Array<[number, number]> = [];
	let start = -1;
	for (let h = 0; h <= 360; h++) {
		if (h < 360 && oklchCusp(h).l <= DARK_MAX_LIGHTNESS) {
			if (start < 0) start = h;
		} else if (start >= 0) {
			intervals.push([start, h - 1]);
			start = -1;
		}
	}
	return intervals;
})();

const LIGHT_HUE_INTERVALS: readonly HueInterval[] = [[195, 330]];

/** Walk outward along the admissible arc until ≥ MIN_HUE_DISTANCE from every theme hue. */
function findSafeHue(pos: number, occupied: number[], intervals: readonly HueInterval[]): number {
	const total = arcLength(intervals);
	const hueAt = (p: number) => arcToHue(intervals, Math.max(0, Math.min(total - 1, p)));
	const target = hueAt(pos);
	if (occupied.length === 0) return target;
	if (occupied.every((h) => hueDistance(target, h) >= MIN_HUE_DISTANCE)) return target;
	for (let d = 1; d < total; d++) {
		for (const dir of [1, -1]) {
			const candidate = hueAt(pos + d * dir);
			if (occupied.every((h) => hueDistance(candidate, h) >= MIN_HUE_DISTANCE)) return candidate;
		}
	}
	return target;
}

/**
 * Port of oh-my-pi getSessionAccentHex: the session-name hash picks only the
 * hue (theme-aware arc, collision-shifted); lightness/chroma are carried from
 * the theme accent, re-normalized at the target hue's gamut cusp; clamped
 * visible on dark surfaces, WCAG-AA bisected on light ones.
 */
export function getSessionAccentHex(name: string, theme: SessionAccentInputs): string {
	const isDark = theme.surfaceLuminance === undefined;
	const intervals = isDark ? DARK_HUE_INTERVALS : LIGHT_HUE_INTERVALS;
	const pos = nameToHash(name) % arcLength(intervals);
	const themeHues = theme.colorHexes.map(hexToHue).filter((h): h is number => h !== undefined);
	const targetHue = findSafeHue(pos, themeHues, intervals);
	const accent = hexToOklch(theme.accentHex);
	const usable =
		Number.isFinite(accent.l) && Number.isFinite(accent.c) && Number.isFinite(accent.h) &&
		accent.c >= MIN_CHROMA_FOR_HUE;
	const target = oklchCusp(targetHue);
	let lightness: number;
	let chromaFraction: number;
	if (usable) {
		const source = oklchCusp(accent.h);
		lightness = accent.l <= source.l
			? (accent.l / source.l) * target.l
			: target.l + ((accent.l - source.l) / (1 - source.l)) * (1 - target.l);
		chromaFraction = accent.c / source.c;
	} else {
		lightness = target.l;
		chromaFraction = FALLBACK_CUSP_CHROMA_FRACTION;
	}
	const chroma = Math.max(MIN_CHROMA, Math.min(MAX_CHROMA, chromaFraction * target.c));
	if (isDark) {
		const l = Math.max(DARK_MIN_LIGHTNESS, Math.min(DARK_MAX_LIGHTNESS, lightness));
		return oklchToHex({ l, c: chroma, h: targetHue });
	}
	const cap = accentLuminanceCap(theme.surfaceLuminance!);
	const top = oklchToHex({ l: lightness, c: chroma, h: targetHue });
	if ((relativeLuminance(top)) <= cap) return top;
	let lo = 0, hi = lightness;
	for (let i = 0; i < 20; i++) {
		const mid = (lo + hi) / 2;
		if (relativeLuminance(oklchToHex({ l: mid, c: chroma, h: targetHue })) > cap) hi = mid;
		else lo = mid;
	}
	return oklchToHex({ l: lo, c: chroma, h: targetHue });
}

/** A colorizer that wraps text in the session-accent truecolor SGR. */
export type AccentFn = (text: string) => string;

/**
 * Resolve the session accent colorizer for the current render.
 * Returns null (callers fall back to `theme.fg("dim", …)`) when the config is
 * off, the session is unnamed, omp didn't hand us the theme inputs, or the
 * inputs are malformed — degraded = today's tokens-only look, never a crash.
 */
export function resolveAccent(
	enabled: boolean,
	sessionName: string | undefined | null,
	inputs: SessionAccentInputs | undefined,
): AccentFn | null {
	if (!enabled || !sessionName || !inputs) return null;
	const { accentHex, colorHexes, surfaceLuminance } = inputs;
	// Upstream's fallback path would happily derive from a garbage accent — a
	// color with no relation to the theme. Ours degrades instead: null → dim.
	if (typeof accentHex !== "string" || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accentHex) || !Array.isArray(colorHexes)) return null;
	let hex: string;
	try {
		hex = getSessionAccentHex(sessionName, { accentHex, colorHexes, surfaceLuminance });
	} catch {
		return null;
	}
	if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return (text: string) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}
