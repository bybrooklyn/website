// Everything typing turns into something else, in one table: what is typed, what it becomes, how a
// file keeps it, and where the meaning comes from. The owner's rule is "prefer base markdown first":
// where characters already mean something in standard Markdown (CommonMark) or GitHub's, that
// meaning wins, and an extra is taken only where Markdown gives the characters no meaning at all.
//
// keys.ts builds its inline pairs and the line marks it knows from this table, the Ctrl+/ panel lists
// it under "Typing", and keys.test.ts types every example and checks the Markdown it writes.

import type { Mark } from "./document";

/** Where a piece of typing's meaning comes from. */
export type Origin = "Markdown" | "GitHub" | "extra";

/** One thing typing does. */
export interface Typed {
    /** What is typed, as the panel shows it. */
    typed: string;
    /** What it becomes. */
    becomes: string;
    /** How a file keeps it. */
    saved: string;
    origin: Origin;
    /** Typed into an empty document (each character in turn, `\n` as Enter), and the Markdown that is then written. Left out where a test of its own covers it. */
    example?: [string, string];
    /** At the start of a line: the mark, as a pattern for what is before the space that completes it. */
    line?: RegExp;
    /** In a line: the mark it makes, the pattern of the text before the cursor once the closing sign is typed (group 1 is what comes before the opening sign, group 2 the text), and how many signs each side. */
    pair?: { mark: Mark; pattern: RegExp; width: number };
}

/** The whole of what typing turns into something, in the order the panel lists it. */
export const TYPING: Typed[] = [
    // ---- at the start of a line ----
    { typed: "# to ###### then a space", becomes: "Heading 1 to 6", saved: "# Heading", origin: "Markdown", example: ["## Small", "## Small\n"], line: /#{1,6}/ },
    { typed: "- or * or + then a space", becomes: "Bulleted list", saved: "- item", origin: "Markdown", example: ["* item", "- item\n"], line: /[-*+]/ },
    { typed: "1. or 1) then a space", becomes: "Numbered list, from that number", saved: "1. item", origin: "Markdown", example: ["3. third", "3. third\n"], line: /\d{1,9}[.)]/ },
    { typed: "a. or i. then a space", becomes: "Numbered list (a file keeps numbers; nested numbers are drawn as letters, then roman numerals)", saved: "1. item", origin: "extra", example: ["a. first", "1. first\n"], line: /[aAiI][.)]/ },
    { typed: "[ ] or [x] then a space", becomes: "Checklist, empty or ticked", saved: "- [ ] item", origin: "GitHub", example: ["[x] done", "- [x] done\n"], line: /\[[ xX]\]/ },
    { typed: "[] then a space", becomes: "Checklist", saved: "- [ ] item", origin: "extra", example: ["[] to do", "- [ ] to do\n"], line: /\[\]/ },
    { typed: "> then a space", becomes: "Quote", saved: "> quoted", origin: "Markdown", example: ["> quoted", "> quoted\n"], line: />/ },
    { typed: ">>> then a space", becomes: "Quote of everything after, to the end", saved: "> each line", origin: "extra", example: [">>> one\ntwo", "> one\n>\n> two\n"] },
    { typed: "-# then a space", becomes: "Subtext: small quiet text", saved: "-# text", origin: "extra", example: ["-# small print", "-# small print\n"] },
    { typed: "[!NOTE] then a space", becomes: "Callout (NOTE, TIP, IMPORTANT, WARNING, CAUTION)", saved: "> [!NOTE]", origin: "GitHub" },
    { typed: "``` (three backticks)", becomes: "Code block", saved: "```", origin: "Markdown", example: ["```", "```\n```\n"] },
    { typed: "$$ on an empty line", becomes: "Block of maths", saved: "$$", origin: "extra" },
    { typed: "--- on an empty line", becomes: "Horizontal line", saved: "---", origin: "Markdown" },
    { typed: ": then a space, under a line", becomes: "Definition of the line above", saved: ": definition", origin: "extra" },
    { typed: "<details> on an empty line", becomes: "Folding section", saved: "<details>", origin: "Markdown" },
    // ---- in a line, once the closing sign is typed ----
    { typed: "**bold**", becomes: "Bold", saved: "**bold**", origin: "Markdown", example: ["a **b**", "a **b**\n"], pair: { mark: "bold", pattern: /(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, width: 2 } },
    { typed: "__bold__", becomes: "Bold", saved: "**bold**", origin: "Markdown", example: ["a __b__", "a **b**\n"], pair: { mark: "bold", pattern: /(^|[^_\p{L}\p{N}])__([^_\s](?:[^_]*[^_\s])?)__$/u, width: 2 } },
    { typed: "~~strike~~", becomes: "Strikethrough", saved: "~~strike~~", origin: "GitHub", example: ["a ~~b~~", "a ~~b~~\n"], pair: { mark: "strike", pattern: /(^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, width: 2 } },
    { typed: "||spoiler||", becomes: "Spoiler, hidden until pressed", saved: "||spoiler||", origin: "extra", example: ["a ||b||", "a ||b||\n"], pair: { mark: "spoiler", pattern: /(^|[^|])\|\|([^|\s](?:[^|]*[^|\s])?)\|\|$/, width: 2 } },
    { typed: "==marked==", becomes: "Marked", saved: "==marked==", origin: "extra", example: ["a ==b==", "a ==b==\n"], pair: { mark: "mark", pattern: /(^|[^=])==([^=\s](?:[^=]*[^=\s])?)==$/, width: 2 } },
    { typed: "*italic*", becomes: "Italic", saved: "*italic*", origin: "Markdown", example: ["a *b*", "a *b*\n"], pair: { mark: "italic", pattern: /(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, width: 1 } },
    { typed: "_italic_", becomes: "Italic", saved: "*italic*", origin: "Markdown", example: ["a _b_", "a *b*\n"], pair: { mark: "italic", pattern: /(^|[^_\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_$/u, width: 1 } },
    { typed: "~strike~", becomes: "Strikethrough", saved: "~~strike~~", origin: "GitHub", example: ["a ~b~", "a ~~b~~\n"], pair: { mark: "strike", pattern: /(^|[^~])~([^~\s](?:[^~]*[^~\s])?)~$/, width: 1 } },
    { typed: "`code`", becomes: "Code in the line", saved: "`code`", origin: "Markdown", example: ["a `b`", "a `b`\n"], pair: { mark: "code", pattern: /(^|[^`])`([^`]+)`$/, width: 1 } },
    { typed: "^superscript^", becomes: "Superscript", saved: "<sup>superscript</sup>", origin: "extra", example: ["x ^2^", "x <sup>2</sup>\n"], pair: { mark: "sup", pattern: /(^|[^^[])\^([^^\s]+)\^$/, width: 1 } },
    { typed: ":smile: (a known name between colons)", becomes: "Emoji", saved: ":smile:", origin: "extra" },
    { typed: ": and two letters", becomes: "A list of emoji to choose from; Tab or Enter puts one in, anything else leaves the text as typed", saved: "the emoji's name between colons", origin: "extra" },
    { typed: "-> <- => != <= >= ... (c) and others", becomes: "Arrows and signs (Tools, Typed signs)", saved: "the character", origin: "extra" },
];

/** The inline pairs keys.ts completes, double signs before single ones. */
export const PAIRS = TYPING.flatMap((each) => (each.pair ? [each.pair] : []));

/** What, typed at the start of a line and followed by a space, turns that line into a block. */
export const LINE_MARK = new RegExp(`^(${TYPING.flatMap((each) => (each.line ? [each.line.source] : [])).join("|")}) $`);

/** The lines of the table whose words have what was typed, for the Ctrl+/ panel's search. */
export function findTyping(query: string): Typed[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return TYPING;
    return TYPING.filter((each) => [each.typed, each.becomes, each.saved, each.origin].some((words) => words.toLowerCase().includes(wanted)));
}
