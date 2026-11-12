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
