// Two pieces of Discord's Markdown that mdQuire writes, taught to the site's Markdown so that a post
// draws them as the editor does: `-# text` at the start of a paragraph is small quiet text (the
// paragraph gets the class "subtext"), and `||text||` is a spoiler, covered until pressed (a span
// with the class "spoiler" that can be focused, which prose.css uncovers while it has focus, so no
// script is needed and a screen reader reads the words as they are). Standard Markdown gives neither
// any meaning, so nothing a post already says changes. Pipes written escaped (`\|\|`), and anything
// in code, stay as they are; a spoiler is found inside one run of plain text, so one whose words are
// partly bold is left as typed. It is a hast plugin of the site's Markdown processor (astro.config.ts).

import type { HastPluginDefinition } from "satteri";

/** A paragraph's first text with its `-# ` taken off, or undefined if it does not start so. */
export function subtextOf(value: string): string | undefined {
    const found = /^-#[ \t]+(?=\S)/.exec(value);
    return found ? value.slice(found[0].length) : undefined;
}

/** Spoilers in a run of text: two pipes, words that neither start nor end with a space, two pipes. */
const SPOILER = /(?<![|\\])\|\|(?=[^|\s])([^|]*?[^|\s])\|\|(?!\|)/g;

/** A run of text cut into its plain parts and its spoilers, or undefined if it has none. `raw` is the Markdown it was read from, where escaped pipes can still be told apart. */
export function spoilersIn(value: string, raw?: string): (string | { spoiler: string })[] | undefined {
    // pipes the writer escaped are text: if the Markdown has no unescaped pair, there is no spoiler
    if (raw !== undefined && !/(?<!\\)\|\|/.test(raw)) return undefined;
    const pieces: (string | { spoiler: string })[] = [];
    let at = 0;
    for (const match of value.matchAll(SPOILER)) {
        if (match.index > at) pieces.push(value.slice(at, match.index));
        pieces.push({ spoiler: match[1]! });
        at = match.index + match[0].length;
    }
    if (pieces.length === 0) return undefined;
    if (at < value.length) pieces.push(value.slice(at));
    return pieces;
}

const LITERAL = new Set(["code", "pre", "script", "style", "kbd", "samp"]);

/** The plugin: subtext and spoilers in every post's Markdown. */
export const discordMarkdown: HastPluginDefinition = {
    name: "discord-markdown",
    options: { position: true },
    text(node, ctx) {
        const parent = ctx.parent(node) as { type: string; tagName?: string } | undefined;
        if (!parent || (parent.type === "element" && LITERAL.has(parent.tagName ?? ""))) return;
        let value = node.value;
        let changed = false;
        if (parent.type === "element" && parent.tagName === "p" && ctx.indexOf(node) === 0) {
            const rest = subtextOf(value);
            if (rest !== undefined) {
                ctx.setProperty(parent as never, "className", ["subtext"]);
                value = rest;
                changed = true;
            }
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const raw = start !== undefined && end !== undefined ? ctx.source.slice(start, end) : undefined;
        const pieces = value.includes("||") ? spoilersIn(value, raw) : undefined;
        if (pieces) {
            ctx.replaceNode(
                node,
                pieces.map((piece) =>
                    typeof piece === "string"
                        ? { type: "text", value: piece }
                        : { type: "element", tagName: "span", properties: { className: ["spoiler"], tabIndex: 0, title: "A spoiler: press to see it" }, children: [{ type: "text", value: piece.spoiler }] },
                ) as never,
            );
            return;
        }
        if (changed) return { ...node, value };
    },
};
