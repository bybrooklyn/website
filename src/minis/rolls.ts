// What a typed roll means: "2d6+3", "4d6 drop lowest", "d20 adv", "d100".
// Reading it and adding it up are kept apart from throwing the dice, so both can be tested.

import { SIDES, type Sides } from "./tower";

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

/** Reads a typed roll. Returns a sentence saying what is wrong if it cannot be read. */
export function read(text: string): Roll | string {
    const tidy = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!tidy) return "Type a roll, such as 2d6+3.";
    const groups: Group[] = [];
    let plus = 0;
    // one piece at a time: a sign, then either dice (with what to drop) or a number
    const piece = /\s*([+-])?\s*(?:(\d*)d(\d+)((?:\s*(?:drop lowest|drop highest|dl|dh|kh|kl|adv(?:antage)?|dis(?:advantage)?)\s*\d*)*)|(\d+))/y;
    let reached = 0;
    while (reached < tidy.length) {
        piece.lastIndex = reached;
        const found = piece.exec(tidy);
        if (!found || found[0].length === 0) return `I can't read "${tidy.slice(reached).trim()}".`;
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
            else if (word === "kh") drop = count - many;
            else if (word === "kl") drop = -(count - many);
            else {
                // advantage: roll twice and keep the better; disadvantage, the worse
                count = Math.max(count, 2);
                drop = word!.startsWith("adv") ? count - 1 : -(count - 1);
            }
        }
        if (count < 1 || count > 12) return "Between 1 and 12 dice of a kind.";
        if (Math.abs(drop) >= count) return "That drops every die.";
        groups.push({ count, sides: sides as Sides | 100, sign, drop });
    }
    const dice = groups.flatMap((group) => Array.from({ length: group.count * (group.sides === 100 ? 2 : 1) }, (): Sides => (group.sides === 100 ? 10 : group.sides)));
    if (dice.length === 0) return "There are no dice in that.";
    if (dice.length > 16) return "At most 16 dice at once.";
    return { groups, plus, dice };
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
 * The order dice line up in once they have landed: the kind with the most sides first, and within a
 * kind the highest number first. Gives each die's place in `dice`, in that order.
 */
export function lineUp(dice: { sides: Sides; value: number }[]): number[] {
    return dice.map((_, index) => index).sort((a, b) => dice[b]!.sides - dice[a]!.sides || dice[b]!.value - dice[a]!.value || a - b);
}

/**
 * Where a row of `count` things goes in a picture `shape` times as wide as it is high: how big each
 * is, and the middle of each, measured in half-heights of the picture from its middle. They wrap onto
 * as many lines as lets them be largest, and a short last line is centered.
 */
export function row(count: number, shape: number): { size: number; at(place: number): [x: number, y: number] } {
    const [WIDE, TALL] = [1.2, 1.55];
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
