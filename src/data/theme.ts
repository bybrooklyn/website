// Theme colors. Dark only.
// Each color is OKLCH: lightness, chroma, hue.

export type Oklch = readonly [number, number, number];

export const theme = {
    ground: [0.16, 0.035, 300],
    surface: [0.21, 0.045, 300],
    rule: [0.32, 0.055, 300],
    ink: [0.93, 0.02, 300],
    muted: [0.73, 0.045, 300],
} as const satisfies Record<string, Oklch>;

/** A post can swap the accent with `accent:` in its frontmatter. */
export const accents = {
    violet: [0.77, 0.16, 300],
    pink: [0.78, 0.15, 350],
    blue: [0.78, 0.12, 250],
    mint: [0.84, 0.12, 165],
    amber: [0.84, 0.13, 80],
} as const satisfies Record<string, Oklch>;

export type AccentName = keyof typeof accents;

export const accentNames = Object.keys(accents) as [AccentName, ...AccentName[]];

/** Flat colors for the language bar. Anything not listed is drawn as "other". */
export const languageColors: Record<string, Oklch> = {
    Rust: [0.74, 0.15, 45],
    TypeScript: [0.72, 0.13, 250],
    Swift: [0.72, 0.17, 15],
    Python: [0.86, 0.14, 95],
    Go: [0.8, 0.11, 205],
    JavaScript: [0.84, 0.15, 130],
    Astro: [0.74, 0.17, 330],
    "C++": [0.72, 0.15, 5],
    C: [0.68, 0.04, 260],
    "C#": [0.7, 0.16, 145],
    Kotlin: [0.7, 0.17, 295],
    Java: [0.7, 0.13, 65],
    Shell: [0.8, 0.17, 140],
    CSS: [0.62, 0.17, 300],
    HTML: [0.7, 0.18, 35],
    Svelte: [0.7, 0.2, 30],
    Lua: [0.5, 0.15, 270],
    GLSL: [0.75, 0.1, 190],
    QML: [0.78, 0.15, 150],
    MDX: [0.82, 0.1, 85],
    WGSL: [0.75, 0.1, 190],
    Luau: [0.62, 0.14, 250],
    "Go Template": [0.86, 0.09, 205],
};

export const otherLanguageColor: Oklch = [0.56, 0.06, 300];
