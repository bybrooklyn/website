// Typed signs that become the character they stand for, as her words put it: "when someone types -
// then > make it an arrow". Two signs typed one after the other become one character, `->` an arrow,
// `!=` not equal, and so on, once the character typed after them shows that they are the whole of
// what was typed: a space, a letter, anything that is not itself one of the signs. So `!==`, `<=>`,
// `<->` and `->>` stay as typed, as do `-->` and `==>`. What is saved is the character itself. A
// dash is never made: her writing rules (check/writing.ts) do not use a dash as punctuation. `==` and
// `===` are not changed at all; the surface only draws them joined. keys.ts applies this, never inside
// code, a link's address, an HTML tag or a web address, and one Backspace straight after puts the
// characters back.

/** The characters a typed sign is made of: one of these typed next may still be part of it, so nothing is changed yet. */
export const SIGNS = "-<>=!";

/** Each pair of characters typed, and the character it becomes. */
export const SYMBOLS: Record<string, string> = {
    "->": "→",
    "<-": "←",
    "=>": "⇒",
    "!=": "≠",
    "<=": "≤",
    ">=": "≥",
};

/**
 * The character the last two characters of `before` become, or undefined if they stay as typed.
 * `before` is the text up to the character just typed, which keys.ts has seen is not a sign, so the
 * pair is complete. They stay when they are not a pair, when they end a longer run of signs (`-->`,
 * `<=>`, `!==`), when the first is escaped, or inside a code span or maths not yet closed.
 */
export function symbolFor(before: string): string | undefined {
    const pair = before.slice(-2);
    const symbol = SYMBOLS[pair];
    if (!symbol) return undefined;
    const previous = before[before.length - 3] ?? "";
    if ("\\-=<>!".includes(previous) && previous !== "") return undefined;
    // an odd number of backticks or dollars before means a code span or maths is still open
    if ((before.match(/`/g) ?? []).length % 2 === 1) return undefined;
    if ((before.replace(/\\\$/g, "").match(/\$/g) ?? []).length % 2 === 1) return undefined;
    return symbol;
}
