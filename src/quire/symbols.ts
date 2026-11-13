// Typed signs that become the character they stand for, as her words put it: "when someone types -
// then > make it an arrow". Two characters typed one after the other become one: `->` an arrow,
// `!=` not equal, and so on. What is saved is the character itself. A dash is never made: her
// writing rules (check/writing.ts) do not use a dash as punctuation. `==` and `===` are not changed
// at all; the surface only draws them joined. keys.ts applies this, never inside code or maths, and
// one Backspace straight after puts the two characters back.

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
 * The character the last two characters of `before` (the text up to the cursor, the last character
 * just typed) become, or undefined if they stay as typed: when they are not a pair, when they are
 * part of a longer run of signs (`-->`, `==>`, `!==`), when the first is escaped, or when they are
 * inside a code span or maths not yet closed.
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
