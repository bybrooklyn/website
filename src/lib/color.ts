import { accents, theme, type AccentName, type Oklch } from "../data/theme";

export function css([l, c, h]: Oklch): string {
    return `oklch(${l} ${c} ${h})`;
}

/** OKLCH to linear sRGB, clamped to the gamut. */
function toLinearRgb([l, c, h]: Oklch): [number, number, number] {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [
        clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
        clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
        clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    ];
}

function luminance(color: Oklch): number {
    const [r, g, b] = toLinearRgb(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
export function contrast(first: Oklch, second: Oklch): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [number, number];
    return (lighter + 0.05) / (darker + 0.05);
}

export function hex(color: Oklch): string {
    const encode = (value: number) => {
        const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${toLinearRgb(color).map(encode).join("")}`;
}

// Fail the build rather than ship text that is hard to read.
const mustBeReadable: [string, Oklch, number][] = [
    ["text", theme.ink, 7],
    ["muted text", theme.muted, 4.5],
    ...Object.entries(accents).map(([name, color]): [string, Oklch, number] => [`${name} accent`, color, 4.5]),
];
for (const [what, color, minimum] of mustBeReadable) {
    const ratio = contrast(color, theme.surface);
    if (ratio < minimum) throw new Error(`Theme: ${what} contrast is ${ratio.toFixed(2)}, needs ${minimum}.`);
}

/** Custom properties for the root element. */
export function themeStyle(accent: AccentName = "violet"): string {
    return [
        ...Object.entries(theme).map(([name, color]) => `--${name}:${css(color)}`),
        `--accent:${css(accents[accent])}`,
    ].join(";");
}
