// What a typed roll means: "2d6+3", "4d6 drop lowest", "d20 adv", "d100".
// Reading it and adding it up are kept apart from throwing the dice, so both can be tested.

import { list, record, text } from "./checked";
import { SIDES, type Sides } from "./tower";

/** The most dice the tower takes at once. */
export const MOST = 60;

export interface Group {
    /** How many dice, of how many sides, and whether the group is added or taken away. */
    count: number;
    sides: Sides | 100;
    sign: 1 | -1;
    /** How many of the lowest (or, negative, of the highest) to leave out. */
    drop: number;
}

export interface Roll {
    groups: Group[];
    /** The plain number added on. */
    plus: number;
    /** The dice to put in the tower, in order: a d100 is two d10s. */
    dice: Sides[];
}

/** The longest roll that is read, in characters once tidied: far more than sixty dice can need, so that a link cannot hand in a megabyte. */
const LONGEST = 500;

/** A roll as it is read and kept: in small letters, with each run of spaces made one. */
export const tidy = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Reads a typed roll. Returns a sentence saying what is wrong if it cannot be read. */
export function read(text: string): Roll | string {
    const written = tidy(text);
    if (!written) return "Type a roll, such as 2d6+3.";
    if (written.length > LONGEST) return "That roll is too long to read.";
    const groups: Group[] = [];
    let plus = 0;
    // one piece at a time: a sign, then either dice (with what to drop) or a number
    const piece = /\s*([+-])?\s*(?:(\d*)d(\d+)((?:\s*(?:drop lowest|drop highest|dl|dh|kh|kl|adv(?:antage)?|dis(?:advantage)?)\s*\d*)*)|(\d+))/y;
    let reached = 0;
    while (reached < written.length) {
        piece.lastIndex = reached;
        const found = piece.exec(written);
        if (!found || found[0].length === 0) return `I can't read "${written.slice(reached).trim()}".`;
        reached = piece.lastIndex;
        const sign = found[1] === "-" ? -1 : 1;
        if (found[5] !== undefined) {
            plus += sign * Number(found[5]);
            continue;
        }
        let count = Number(found[2] || 1);
        const sides = Number(found[3]);
        if (sides !== 100 && !SIDES.includes(sides as Sides)) return `There is no d${sides} in the tower: d4, d6, d8, d10, d12, d20 or d100.`;
        let drop = 0;
        for (const [, word, amount] of (found[4] ?? "").matchAll(/(drop lowest|drop highest|dl|dh|kh|kl|adv(?:antage)?|dis(?:advantage)?)\s*(\d*)/g)) {
            const many = Number(amount || 1);
            if (word === "drop lowest" || word === "dl") drop = many;
            else if (word === "drop highest" || word === "dh") drop = -many;
            // keeping more than were rolled keeps them all, rather than dropping from the other end
            else if (word === "kh") drop = Math.max(0, count - many);
            else if (word === "kl") drop = -Math.max(0, count - many);
            else {
                // advantage: roll twice and keep the better; disadvantage, the worse
                count = Math.max(count, 2);
                drop = word!.startsWith("adv") ? count - 1 : -(count - 1);
            }
        }
        if (count < 1 || count > MOST) return `Between 1 and ${MOST} dice of a kind.`;
        if (Math.abs(drop) >= count) return "That drops every die.";
        groups.push({ count, sides: sides as Sides | 100, sign, drop });
    }
    const dice = groups.flatMap((group) => Array.from({ length: group.count * (group.sides === 100 ? 2 : 1) }, (): Sides => (group.sides === 100 ? 10 : group.sides)));
    if (dice.length === 0) return "There are no dice in that.";
    if (dice.length > MOST) return `At most ${MOST} dice at once.`;
    return { groups, plus, dice };
}

/** A roll as the history keeps it: as it was written, what each die showed, and the total. */
export interface Rolled {
    what: string;
    said: string;
    total: number;
}

/** The rolls kept from an earlier visit, read back as at most thirty sane entries; any that is not one is left out. */
export function keptHistory(value: unknown): Rolled[] {
    return list(value, 30, (item) => {
        const entry = record(item);
        const [what, said] = [text(entry?.what, LONGEST, ""), text(entry?.said, LONGEST * 8, "")];
        const sum = entry?.total;
        return what && said && typeof sum === "number" && Number.isFinite(sum) ? { what, said, total: sum } : undefined;
    });
}

/** Adds a roll up from what the dice showed, in the order of `roll.dice`. */
export function total(roll: Roll, shown: number[]): { total: number; said: string } {
    let next = 0;
    let sum = roll.plus;
    const parts: string[] = [];
    for (const group of roll.groups) {
        const values = Array.from({ length: group.count }, () => {
            if (group.sides !== 100) return shown[next++]!;
            // tens and ones, each from a d10 that shows 1 to 10 with 10 standing for 0; two zeros are 100
            const [tens, ones] = [shown[next++]! % 10, shown[next++]! % 10];
            return tens * 10 + ones || 100;
        });
        const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
        const out = new Set((group.drop > 0 ? order.slice(0, group.drop) : group.drop < 0 ? order.slice(group.drop) : []).map((one) => one.index));
        const kept = values.filter((_, index) => !out.has(index));
        sum += group.sign * kept.reduce((a, b) => a + b, 0);
        parts.push(`${group.sign < 0 ? "- " : parts.length ? "+ " : ""}${group.count}d${group.sides} [${values.map((value, index) => (out.has(index) ? `(${value})` : value)).join(", ")}]`);
    }
    if (roll.plus) parts.push(`${roll.plus < 0 ? "-" : "+"} ${Math.abs(roll.plus)}`);
    return { total: sum, said: parts.join(" ") };
}

/**
 * The numbers a roll came to, one for each die, a d100 being one number though it is two dice: how
 * many sides, what it showed, and which of the dice in the tower made it.
 */
export function numbers(roll: Roll, shown: number[]): { sides: number; value: number; dice: number[]; dropped: boolean; sign: 1 | -1 }[] {
    let next = 0;
    return roll.groups.flatMap((group) => {
        const rolled = Array.from({ length: group.count }, () => {
            if (group.sides !== 100) return { sides: group.sides as number, value: shown[next]!, dice: [next++], dropped: false, sign: group.sign };
            const [tens, ones] = [next++, next++];
            return { sides: 100, value: (shown[tens]! % 10) * 10 + (shown[ones]! % 10) || 100, dice: [tens, ones], dropped: false, sign: group.sign };
        });
        // the ones left out of the sum, as `total` leaves them out: the lowest, or the highest
        const order = rolled.map((_, index) => index).sort((a, b) => rolled[a]!.value - rolled[b]!.value);
        for (const index of group.drop > 0 ? order.slice(0, group.drop) : group.drop < 0 ? order.slice(group.drop) : []) rolled[index]!.dropped = true;
        return rolled;
    });
}

/**
 * The order numbers line up in once the dice have landed: the kind with the most sides first, and
 * within a kind the highest number first. Gives each one's place in `rolled`, in that order.
 */
export function lineUp(rolled: { sides: number; value: number }[]): number[] {
    return rolled.map((_, index) => index).sort((a, b) => rolled[b]!.sides - rolled[a]!.sides || rolled[b]!.value - rolled[a]!.value || a - b);
}

/**
 * Where a row of `count` things goes in a picture `shape` times as wide as it is high: how big each
 * is, and the middle of each, measured in half-heights of the picture from its middle. They wrap onto
 * as many lines as lets them be largest, and a short last line is centered.
 */
export function row(count: number, shape: number, WIDE = 1.2): { size: number; at(place: number): [x: number, y: number] } {
    // (`WIDE` is how wide a place is against how big a thing in it is: more for numbers of two or three figures, so that neighbours do not touch)
    const TALL = 1.55;
    let [size, columns] = [0, 1];
    for (let across = 1; across <= count; across++) {
        const fits = Math.min(0.27, (2 * shape * 0.9) / (WIDE * across), 1.3 / (TALL * Math.ceil(count / across)));
        // as large as can be, and of the ways that are as large, the one with the fewest lines
        if (fits >= size) [size, columns] = [fits, across];
    }
    const lines = Math.ceil(count / columns);
    return {
        size,
        at(place) {
            const line = Math.floor(place / columns);
            const inLine = line === lines - 1 ? count - line * columns : columns;
            return [((place % columns) - (inLine - 1) / 2) * WIDE * size, 0.2 + ((lines - 1) / 2 - line) * TALL * size];
        },
    };
}
