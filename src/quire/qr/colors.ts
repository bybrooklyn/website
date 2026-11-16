// The colors a code is drawn in, and whether a phone can still tell its dark from its light: colors as
// six hex digits, their relative luminance and the contrast of two (as WCAG counts them), a color made
// deeper until it stands far enough from the ground, a rainbow at one lightness (OKLCH turned to sRGB),
// and the pride flags' stripes. The flags are the minis' table (`src/minis/flags.ts`), copied, as the
// suite imports nothing from outside `src/quire/`; a test holds the two the same.

/** A pride flag: its name, and its stripes' colors from the top, a wide stripe written as many times as it is wide. */
export interface Flag {
    name: string;
    stripes: string[];
}

/** The flags offered, in the order the minis show them. */
export const FLAGS: Flag[] = [
    { name: "rainbow", stripes: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"] },
    { name: "trans", stripes: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"] },
    { name: "lesbian", stripes: ["#d52d00", "#ff9a56", "#ffffff", "#d362a4", "#a30262"] },
    { name: "bisexual", stripes: ["#d60270", "#d60270", "#9b4f96", "#0038a8", "#0038a8"] },
    { name: "pansexual", stripes: ["#ff218c", "#ffd800", "#21b1ff"] },
    { name: "nonbinary", stripes: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"] },
];

/** A color as six hex digits made red, green and blue from 0 to 255; three digits are doubled, and anything else is black. */
export function rgbOf(hex: string): [number, number, number] {
    let digits = hex.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(digits)) digits = [...digits].map((each) => each + each).join("");
    if (!/^[0-9a-f]{6}$/i.test(digits)) return [0, 0, 0];
    const value = parseInt(digits, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Red, green and blue from 0 to 255 written as six hex digits. */
export const hexOf = ([r, g, b]: number[]): string => `#${[r, g, b].map((each) => Math.round(Math.min(255, Math.max(0, each!))).toString(16).padStart(2, "0")).join("")}`;

/** True for a color written as three or six hex digits, with or without its #. */
export const isHex = (text: string): boolean => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.trim());

/** A color written the one way: # and six lowercase hex digits. */
export const normalHex = (text: string): string => hexOf(rgbOf(text));

const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** A color's relative luminance, from 0 for black to 1 for white. */
export function luminance(hex: string): number {
    const [r, g, b] = rgbOf(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast of two colors, from 1 (the same) to 21 (black and white). */
export function contrast(a: string, b: string): number {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
}

/** The least contrast between the code's dark and its ground at which it is drawn as asked; below it a phone may not tell them apart. */
export const ENOUGH = 3;

/** A color made darker in even steps toward black, or lighter toward white, until it stands `least` from the ground; as it was if it already does. */
export function deepened(color: string, ground: string, least = ENOUGH + 0.5): string {
    if (contrast(color, ground) >= least) return normalHex(color);
    const lighter = luminance(ground) < 0.18;
    const [r, g, b] = rgbOf(color);
    for (let step = 1; step <= 40; step++) {
        const keep = 1 - step / 40;
        const made = lighter ? hexOf([r + (255 - r) * (1 - keep), g + (255 - g) * (1 - keep), b + (255 - b) * (1 - keep)]) : hexOf([r * keep, g * keep, b * keep]);
        if (contrast(made, ground) >= least) return made;
    }
    return lighter ? "#ffffff" : "#000000";
}

/** An OKLCH color (lightness 0 to 1, chroma, hue in degrees) as sRGB hex, brought inside sRGB by lowering its chroma. */
export function oklchHex(lightness: number, chroma: number, hue: number): string {
    for (let c = chroma; c >= 0; c -= 0.005) {
        const a = c * Math.cos((hue * Math.PI) / 180);
        const b = c * Math.sin((hue * Math.PI) / 180);
        const l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const s_ = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
        const rgb = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
        if (rgb.every((each) => each >= -0.0005 && each <= 1.0005)) return hexOf(rgb.map((each) => 255 * (each <= 0.0031308 ? 12.92 * each : 1.055 * Math.max(0, each) ** (1 / 2.4) - 0.055)));
    }
    return hexOf([lightness * 255, lightness * 255, lightness * 255]);
}

/** The rainbow's colors, from red round to violet, all at one lightness so every one stands as well from a light ground. */
export function rainbow(count = 7, lightness = 0.5): string[] {
    return Array.from({ length: count }, (_, i) => oklchHex(lightness, 0.2, 25 + (i * 300) / (count - 1)));
}

/** What the colors say about being read: nothing when they are fine, else a plain sentence. `inks` are every color the dark modules take. */
export function scanWord(inks: string[], ground: string | undefined): string | undefined {
    const behind = ground ?? "#ffffff";
    const least = Math.min(...inks.map((each) => contrast(each, behind)));
    if (least < 1.6) return "The code and its ground are too alike for a phone to read.";
    if (least < ENOUGH) return "The code and its ground are close in lightness, so some phones will not read it.";
    if (inks.some((each) => luminance(each) > luminance(behind))) return "The code is lighter than its ground. Many phones read that, but not all.";
    return undefined;
}
