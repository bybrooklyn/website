// The Dice mini's luck: every number each kind of die has shown, and what that says beside what
// chance would give. Kept apart from the scene so that it can be tested.

import { record, whole } from "./checked";

/** For each kind of die, by its sides: how often each of its numbers has come up. A d100 is counted by tens. */
export type Luck = Record<string, number[]>;

/** The kinds of die the tower has, by sides. */
const KINDS = [4, 6, 8, 10, 12, 20, 100];

/** Luck kept from an earlier visit, read back only as whole counts, one for each face of a real die; anything else is left out. */
export function keptLuck(value: unknown): Luck {
    const luck: Luck = {};
    for (const [sides, counts] of Object.entries(record(value) ?? {})) {
        const faces = Number(sides) === 100 ? 10 : Number(sides);
        if (!KINDS.includes(Number(sides)) || !Array.isArray(counts) || counts.length !== faces || !counts.every((count) => typeof count === "number")) continue;
        luck[sides] = counts.map((count: number) => whole(count, 0, 1e9, 0));
    }
    return luck;
}

/** What is said about one kind of die. */
export interface Fortune {
    sides: number;
    /** A sentence: how many, their average, what chance says, and a verdict. */
    line: string;
    /** How often each number came up, from 0 to 1 of the most frequent. */
    bars: number[];
    /** Where an even spread would stand on the same scale. */
    even: number;
}

/** Adds one number a die showed. */
export function tally(luck: Luck, sides: number, value: number): void {
    const faces = sides === 100 ? 10 : sides;
    const counts = (luck[sides] ??= Array.from({ length: faces }, () => 0));
    const place = sides === 100 ? Math.min(9, Math.floor((value - 1) / 10)) : value - 1;
    if (place >= 0 && place < faces) counts[place]!++;
}

/** The verdict on an average: how far it is from chance, counted in the spread chance itself has. */
export function verdict(sides: number, rolled: number, average: number): string {
    if (rolled < 10) return "too few to say";
    const spread = Math.sqrt((sides * sides - 1) / 12 / rolled);
    const off = (average - (sides + 1) / 2) / spread;
    if (off > 3) return "blessed";
    if (off > 2) return "lucky";
    if (off < -3) return "cursed";
    if (off < -2) return "unlucky";
    return "about what chance says";
}

/** What to say about each kind of die that has been rolled, smallest die first. */
export function fortune(luck: Luck): Fortune[] {
    return Object.keys(luck)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap((sides): Fortune[] => {
            const counts = luck[sides]!;
            const rolled = counts.reduce((sum, count) => sum + count, 0);
            if (rolled === 0) return [];
            // a d100 is kept by tens, so its average is taken from the middle of each ten
            const average = counts.reduce((sum, count, place) => sum + count * (sides === 100 ? place * 10 + 5.5 : place + 1), 0) / rolled;
            const most = Math.max(...counts);
            return [{
                sides,
                line: `d${sides}: ${rolled} rolled, average ${average.toFixed(1)}, chance says ${((sides + 1) / 2).toFixed(1)}: ${verdict(sides, rolled, average)}`,
                bars: counts.map((count) => count / most),
                even: rolled / counts.length / most,
            }];
        });
}
