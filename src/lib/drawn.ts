// The pattern on a drawn cover: squares worked out from the letters of a name, so each name gets its
// own and always the same one. DrawnCover.astro draws it; scripts/pictures.ts draws the shared cards.

export interface Cell {
    x: number;
    y: number;
    strength: number;
}

export const COLUMNS = 18;
export const ROWS = 6;

export function cells(name: string): Cell[] {
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
    return found;
}

/** The name as large as fits the width of a cover 320 wide. */
export const nameSize = (name: string) => Math.min(46, 286 / (name.length * 0.55));
