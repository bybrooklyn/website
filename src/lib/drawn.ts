// The pattern on a drawn cover: squares worked out from the letters of a name, so each name gets its
// own and always the same one. DrawnCover.astro draws it; scripts/pictures.ts draws the shared cards.

export interface Cell {
    x: number;
    y: number;
    strength: number;
    /** Which language this square stands for, when the cover is given the languages a project is written in. */
    language?: string;
}

export const COLUMNS = 18;
export const ROWS = 6;

/**
 * The squares for a name. Given the languages a project is written in and each one's share, every
 * square is one of them, as many of each as its share: a cover is then a picture of what the
 * project is made of.
 */
export function cells(name: string, languages: [name: string, share: number][] = []): Cell[] {
    // A run of numbers that depends only on the name.
    let seed = 7;
    for (const letter of name) seed = (Math.imul(seed, 31) + letter.codePointAt(0)!) >>> 0;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const found: Cell[] = [];
    for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < COLUMNS; column++) {
            // Fewer toward the bottom, where the name is.
            if (next() < 0.5 - row * 0.06) found.push({ x: 16 + column * 16, y: 16 + row * 16, strength: 0.2 + next() * 0.8 });
        }
    }
    if (languages.length === 0) return found;
    // Each language gets its share of the squares, at least one, dealt out among them in an order that depends only on the name.
    const total = languages.reduce((sum, [, share]) => sum + share, 0);
    const deal = languages.flatMap(([language, share]) => Array.from({ length: Math.max(1, Math.round((share / total) * found.length)) }, () => language));
    const order = found.map((_, index) => index).sort((a, b) => ((a * 2654435761 + seed) >>> 0) % 997 - ((b * 2654435761 + seed) >>> 0) % 997);
    order.forEach((cell, place) => (found[cell]!.language = deal[Math.min(place, deal.length - 1)] ?? languages[0]![0]));
    return found;
}

/** The name as large as fits the width of a cover 320 wide. */
export const nameSize = (name: string) => Math.min(46, 286 / (name.length * 0.55));

/**
 * A project's emblem: a few large squares, the same on the left as on the right, worked out from
 * its name. Being symmetrical it has a shape of its own that the eye keeps, which a scatter of
 * small squares does not, so projects can be told apart in a list at a glance.
 */
export function emblem(name: string): Cell[] {
    let seed = 11;
    for (const letter of name) seed = (Math.imul(seed, 33) + letter.codePointAt(0)!) >>> 0;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const [ACROSS, DOWN, SIZE, STEP] = [8, 5, 28, 34];
    const [left, top] = [(320 - (ACROSS - 1) * STEP - SIZE) / 2, (200 - (DOWN - 1) * STEP - SIZE) / 2];
    const found: Cell[] = [];
    for (let row = 0; row < DOWN; row++) {
        for (let column = 0; column < ACROSS / 2; column++) {
            if (next() < 0.42) continue;
            const strength = 0.35 + next() * 0.65;
            for (const at of [column, ACROSS - 1 - column]) found.push({ x: left + at * STEP, y: top + row * STEP, strength });
        }
    }
    return found;
}

/** A color of a project's own, from its place in the list: each a good way round the wheel from the one before, so no two neighbours are alike. */
export const ownHue = (order: number): number => (order * 137.5 + 20) % 360;
