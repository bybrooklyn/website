// Typed signs that become the character they stand for. Two signs typed one after the other become
// one character as the second is typed: `->` an arrow, `!=` not equal, and so on. A sign typed
// straight after that makes a longer run puts the two signs back, so `!==`, `<=>`, `<->` and `->>`
// end as typed, and `-->` and `==>` are never changed. What is saved is the character itself. A dash
// is never made: the site's writing rules (check/writing.ts) do not use a dash as punctuation. `==`
// and `===` are not changed at all; the surface only draws them joined. keys.ts applies this, never
// inside code, a link's address, an HTML tag or a web address, and one Backspace straight after puts
// the characters back.

/** Each pair of characters typed, and the character it becomes. */
export const SYMBOLS: Record<string, string> = {
    "->": "→",
    "<-": "←",
    "=>": "⇒",
    "!=": "≠",
    "<=": "≤",
    ">=": "≥",
};

/** After each made character, the signs that make a longer run with it. */
const LONGER: Record<string, string> = { "→": ">", "←": ">-", "⇒": ">", "≠": "=", "≤": ">=", "≥": "=" };

/** If `before` ends in a made character and then a sign that makes a longer run with it, the two signs the character was made from. */
export function runBefore(before: string): string | undefined {
    const made = before[before.length - 2] ?? "";
    if (!LONGER[made]?.includes(before[before.length - 1] ?? " ")) return undefined;
    return Object.keys(SYMBOLS).find((pair) => SYMBOLS[pair] === made);
}

/**
 * The character the last two characters of `before` become, or undefined if they stay as typed.
 * `before` is the text up to and with the character just typed. They stay when they are not a pair, when they end a longer run of signs (`-->`,
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
