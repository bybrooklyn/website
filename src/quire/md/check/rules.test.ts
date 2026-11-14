// Every rule together, against documents nobody would write: thousands of random and hostile ones
// (malformed percent escapes, lone surrogates, emoji with joiners and modifiers, combining marks,
// control characters, deep lists, ragged tables, links to anything). Held true: checking never
// throws out of a run, a rule that throws reports nothing for itself while the others still run,
// and no document takes longer than a bound. And every fix any rule offers, applied where it was
// offered and in twenty other settings, changes only the text it covers, clears its finding and
// brings no new one.

import { expect, test } from "bun:test";
import type { Document, Run } from "../document";
import { read } from "../read";
import { write } from "../write";
import { check, createChecker, DEFAULTS, type Finding, type Rule, type Settings, type Unit } from "./engine";
import { unpackDictionary } from "./dictionary";
import { RULES } from "./rules";
import { inlines } from "./markdown";
import { createSpeller } from "./spelling";

const root = new URL("../../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());
const speller = createSpeller(words, "us");
/** The British speller, for the rule on a word spelled two ways: only in British spelling does the dictionary hold both of a pair (organise, organize). */
const british = createSpeller(words, "gb");
const spellerFor = (id: string) => (id === "prose-two-spellings" ? british : speller);
/** Every rule switched on, the passive too. */
const settings: Settings = { ...DEFAULTS, rules: Object.fromEntries(RULES.map((rule) => [rule.id, true])) };

/** A small seeded random source, so that a failure can be run again. */
function random(seed: number) {
    let state = seed >>> 0 || 1;
    const next = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
    return { next, pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!, int: (most: number) => Math.floor(next() * most) };
}

/** Pieces a hostile document is made of. */
const PIECES = [
    "word", "the", "the the", "it it", "recieve", "Teh", "colour", "color", "café", "cafe\u0301", "naïve", " ", "  ", "\t", "\n", "\n\n", "\r\n", ".", ". ", "! ", "? ", "...", "…", ",", ";", ": ",
    "*", "**", "***", "_", "__", "`", "``", "~", "~~", "\\", "\\*", "#", "## ", "> ", "- ", "* ", "1. ", "10) ", "- [ ] ", "- [x] ", "|", "| a | b |\n| - | - |\n| c |", "---", "```\ncode\n```", "$$\nx\n$$",
    "[a](#50%)", "[a](file%.md)", "![p](100%.png)", "[x](%E0%A4%A)", "[y](#%)", "[](http://a.b)", "[z]()", "[w](<a b>)", "[^1]", "[^1]: note", "<b>", "</b>", "<!-- c -->", "{x}", "&amp;", "&#0;",
    "https://en.wikipedia.org/wiki/Foo_(bar)", "www.example.com", "me@example.com", "index.html", "C:\\Users",
    "🏳️‍⚧️", "❤️", "👍🏽", "👨‍👩‍👧", "\u200d", "\ufe0f", "\ufe0e", "\u{1F3FD}", "\u0301", "\u0301\u0301\u0301", "\ud800", "\udc00", "\u0000", "\u0007", "\u202e", "\u00a0", "\u2028", "\ufeff", "￼",
    "—", "–", " -- ", "1990-2000", "in order to", "journey", "not just", "is not good, but", "very really quickly", "There are people who", "So, ", "it is",
    "x".repeat(300), "a ".repeat(80), "Ab".repeat(70), "日本語", "مرحبا", "Ⅻ", "ǅ", "ß", "İ",
];

/** A document of random pieces, sometimes very long. */
function hostile(seed: number): string {
    const pick = random(seed);
    const length = pick.next() < 0.05 ? 400 + pick.int(400) : 1 + pick.int(60);
    let text = "";
    for (let index = 0; index < length; index++) text += pick.next() < 0.1 ? String.fromCharCode(pick.int(0x3000)) : pick.pick(PIECES);
    return text;
}

test("no rule throws out of a run, nothing a finding offers throws, and no document takes long", () => {
    let slowest = 0;
    let findings = 0;
    for (let seed = 1; seed <= 3000; seed++) {
        const markdown = hostile(seed);
        const pick = random(seed * 7);
        const exists = () => pick.pick([true, false, undefined]);
        const failed: string[] = [];
        const start = performance.now();
        let found: ReturnType<typeof check> = [];
        let took = 0;
        try {
            const doc = read(markdown, { mdx: seed % 3 === 0 });
            found = check(doc, { settings, speller, exists, failed: (rule) => failed.push(rule) }, RULES);
            took = performance.now() - start;
            // suggestions are worked out one finding at a time when asked for; a few of each document's are asked for here
            for (const one of found.filter((each) => each.suggest).slice(0, 2)) one.suggest!();
        } catch (error) {
            throw new Error(`seed ${seed} threw ${String(error)} on ${JSON.stringify(markdown)}`);
        }
        slowest = Math.max(slowest, took);
        findings += found.length;
        expect([seed, failed]).toEqual([seed, []]);
    }
    console.info(`3,000 hostile documents, ${findings} findings, slowest ${slowest.toFixed(1)} ms`);
    expect(slowest).toBeLessThan(100);
}, 120_000);

test("a malformed percent sign in a link or picture is read as written, and checking goes on", () => {
    for (const markdown of ["[a](#50%) teh\n", "[a](file%.md) teh\n", "![p](100%.png) teh\n"]) {
        const found = check(read(markdown), { settings, speller, exists: () => false }, RULES);
        expect(found.some((one) => one.rule === "spelling" && one.word === "teh")).toBe(true);
    }
    expect(check(read("[a](#50%)\n"), { settings }, RULES).map((one) => one.message)).toContain("This document has no heading for #50%.");
});

// ---- every fix changes exactly what it says ----

/** The letters of a unit with what each carries (marks, look, link), so that two can be compared letter by letter. */
function letters(runs: Run[] | undefined): string[] {
    const out: string[] = [];
    const walk = (list: Run[], href?: string) => {
        for (const run of list) {
            if (run.kind === "link") walk(run.runs, run.href);
            else if (run.kind === "text") {
                const { kind: _kind, text, ...rest } = run;
                const carries = JSON.stringify({ ...rest, marks: [...run.marks].sort(), href });
                for (const char of text) for (let unit = 0; unit < char.length; unit++) out.push(`${char[unit]}${carries}`);
            } else out.push(`${JSON.stringify(run)}${href ?? ""}`);
        }
    };
    walk(runs ?? []);
    return out;
}

/** The units of a document, by path. */
function unitsOf(doc: Document): Map<string, Unit> {
    const checker = createChecker([]);
    const job = checker.start(doc, { settings });
    while (!job.run(() => Infinity));
    return new Map(checker.units().map((unit) => [unit.path.join(), unit]));
}

/** What a finding covers, as words: the key two checks are compared by. */
const keyOf = (units: Map<string, Unit>, one: Finding) => `${one.rule}|${(units.get(one.range.start.path.join())?.read.text ?? "").slice(one.range.start.offset, one.range.end.offset)}`;

/** Places a sentence in twenty settings: in a paragraph with others, a list, a quotation, a cell, beside code, links, marks and hard breaks. */
const INLINE: ((text: string) => string)[] = [
    (text) => text,
    (text) => `Before it. ${text}`,
    (text) => `${text} After it.`,
    (text) => `- ${text}`,
    (text) => `> ${text}`,
    (text) => `1. ${text}`,
    (text) => `**Bold** start. ${text}`,
    (text) => `${text} See C:\\Users here.`,
    (text) => `Line one  \n${text}`,
    (text) => `# Heading\n\n${text}`,
    (text) => `${text}\n\nA second paragraph.`,
    (text) => (text.includes("\n") ? `Plain. ${text}` : `| a | b |\n| - | - |\n| ${text} | x |`),
    (text) => `Some \`code\` here. ${text}`,
    (text) => `A [link](https://example.com) here. ${text}`,
    (text) => `*Italic* words. ${text}`,
    (text) => `> - ${text}`,
    (text) => `Text with "quotes" here. ${text}`,
    (text) => `${text} Then *more* text.`,
    (text) => `- one\n- ${text}\n- three`,
    (text) => `Before it.\n\n${text}\n\nAfter it.`,
];
/** Places blocks among twenty kinds of others. */
const AROUND: ((text: string) => string)[] = [
    ["", ""], ["Before it.\n\n", ""], ["", "\n\nAfter it."], ["## Above\n\n", ""], ["- a list\n- of two\n\n", ""], ["", "\n\n- a list\n- of two"], ["> A quote.\n\n", ""], ["```\ncode block\n```\n\n", ""], ["", "\n\n```\ncode\n```"], ["| a | b |\n| - | - |\n| c | d |\n\n", ""],
    ["Line one  \nline two.\n\n", ""], ["See C:\\Users here.\n\n", ""], ["", "\n\nSee C:\\Users here."], ["x &amp; y.\n\n", ""], ["Some *em* and **strong**.\n\n", ""], ["", "\n\n[^1]: A note."], ["A [link](https://example.com).\n\n", ""], ["---\ntitle: T\n---\n\n", ""], ["Paragraph one.\n\nParagraph two.\n\n", ""], ["", "\n\nThe end."],
].map(([before, after]) => (text: string) => `${before}${text}${after}`);

/** For every rule with a fix: text that makes it fire, and whether it is a sentence (placed in INLINE) or blocks (placed in AROUND). */
const TRIGGERS: [string, string, boolean][] = [
    ["spelling", "I recieve letters.", true],
    ["heading-skip", "# Top\n\n### Skip", false],
    ["heading-top", "# One\n\n# Two", false],
    ["link-empty", "A [word]() here.", true],
    ["bare-url", "See https://en.wikipedia.org/wiki/Foo_(bar) now.", true],
    ["bare-url", "Go to www.example.com today.", true],
    ["bare-url", "See https://example.com/a?b=c, then go.", true],
    ["trailing-space", "Line one   \nline two.", true],
    ["double-space", "Two  spaces here.", true],
    ["list-marker", "- one\n- two\n\n* three\n* four", false],
    ["stray-mark", "A *stray mark here.", true],
    ["stray-mark", "Code `open here.", true],
    ["writing-dash", "It worked — mostly.", true],
    ["writing-dash", "From 1990-2000. -- aside.", true],
    ["writing-dash", "It worked -- mostly.", true],
    ["writing-dash", "Is it? — yes.", true],
    ["writing-emoji", "Done 🎉 now.", true],
    ["writing-emoji", "Hello 👍🏽 there.", true],
    ["writing-semicolon", "The site was slow for years and nobody knew; the fonts were eleven megabytes in all.", true],
    ["writing-filler", "We did it in order to win.", true],
    ["prose-repeat", "It was the the best.", true],
    ["prose-stock", "Due to the fact that it rained, we stayed.", true],
    ["prose-two-spellings", "We organise it. They organize it. We organise more.", true],
    ["prose-quotes", "“One,” she said. “Two.” \"Three.\"", true],
    ["prose-quotes", "It’s mine, it’s yours, it's ours.", true],
    ["prose-capital", "It rained. then it stopped.", true],
];

test("every rule with a fix has text here that makes it fire", () => {
    const withFixes = new Set(TRIGGERS.map(([rule]) => rule));
    for (const rule of RULES) {
        const sample = TRIGGERS.find(([id]) => id === rule.id);
        if (!sample) continue;
        expect(check(read(sample[1]), { settings, speller: spellerFor(rule.id) }, RULES).some((one) => one.rule === rule.id)).toBe(true);
    }
    // the rules that offer no fix at all, so have nothing to hold to it
    const fixless = RULES.map((rule) => rule.id).filter((id) => !withFixes.has(id));
    expect(fixless.sort()).toEqual(["footnote-missing", "footnote-unused", "heading-duplicate", "image-alt", "link-missing", "link-no-text", "prose-adverbs", "prose-long-paragraph", "prose-long-sentence", "prose-opener", "prose-passive", "table-ragged", "writing-keep-out", "writing-not-but", "writing-not-just"]);
});

test("every fix, applied where it was offered and in twenty other settings, changes only what it covers, clears its finding and brings no new one", () => {
    let applied = 0;
    const wrong: string[] = [];
    const same = (where: string, what: string, now: unknown, was: unknown) => {
        if (JSON.stringify(now) !== JSON.stringify(was)) wrong.push(`${where}: ${what}: ${JSON.stringify(now)} where ${JSON.stringify(was)}`);
    };
    for (const [id, sample, inline] of TRIGGERS) {
        let fired = 0;
        for (const place of inline ? INLINE : AROUND) {
            const markdown = `${place(sample)}\n`;
            const doc = read(markdown);
            const before = check(doc, { settings, speller: spellerFor(id) }, RULES);
            const units = unitsOf(doc);
            const keys = before.map((one) => keyOf(units, one));
            for (const finding of before.filter((one) => one.rule === id)) {
                fired++;
                for (const fix of [...finding.fixes, ...(finding.suggest?.().slice(0, 3) ?? [])]) {
                    const where = `${id} "${fix.label}" on ${JSON.stringify(markdown)}`;
                    const after = fix.edit(doc, finding.range);
                    applied++;
                    const path = finding.range.start.path;
                    const unitsAfter = unitsOf(after);
                    if (id !== "list-marker") {
                        // every other block is the same as it was
                        same(where, "other blocks", after.blocks.filter((_, index) => index !== path[0]), doc.blocks.filter((_, index) => index !== path[0]));
                        // in the finding's own text, everything before and after what it covers is the same, letter for letter
                        const was = letters(units.get(path.join())?.runs);
                        const now = letters(unitsAfter.get(path.join())?.runs);
                        const { offset: from } = finding.range.start;
                        const { offset: to } = finding.range.end;
                        same(where, "before it", now.slice(0, from).join(""), was.slice(0, from).join(""));
                        // a full stop in place of a mark gives the next word its capital, as it says
                        const tail = id === "writing-dash" || id === "writing-semicolon" ? 1 : 0;
                        same(where, "after it", now.slice(now.length - (was.length - to - tail)).join(""), was.slice(to + tail).join(""));
                    }
                    if (id === "bare-url") {
                        const address = (units.get(path.join())?.read.text ?? "").slice(finding.range.start.offset, finding.range.end.offset);
                        const link = inlines(unitsAfter.get(path.join())?.runs ?? []).find((one) => one.kind === "link" && one.from === finding.range.start.offset);
                        // the address flagged is the whole address, up to a space or a stop, brackets that pair up included
                        same(where, "what follows the address", /^(?:[\s.,;:!?]|$)/.test((units.get(path.join())?.read.text ?? "").slice(finding.range.end.offset)), true);
                        same(where, "the link made", link && [link.href.replace(/^https:\/\/(?=www\.)/, ""), link.text], [address, address]);
                    }
                    // no stop or comma is put beside another ("2000.. Aside", "2000., aside")
                    const doubled = (text = "") => (text.match(/[.,;:!?]\s*[.,;](?!\.)/g) ?? []).length;
                    same(where, "stops put side by side", doubled(unitsAfter.get(path.join())?.read.text) <= doubled(units.get(path.join())?.read.text), true);
                    // what is written reads back as the same text
                    const again = unitsOf(read(write(after)));
                    for (const [at, unit] of unitsAfter) same(where, `read back at ${at}`, again.get(at)?.read.text, unit.read.text);
                    // the finding is gone, and nothing is found that was not found before
                    const left = [...keys];
                    left.splice(left.indexOf(keyOf(units, finding)), 1);
                    for (const one of check(after, { settings, speller: spellerFor(id) }, RULES)) {
                        const key = keyOf(unitsAfter, one);
                        const index = left.indexOf(key);
                        if (index < 0) wrong.push(`${where}: found after the fix: ${key}`);
                        else left.splice(index, 1);
                    }
                }
            }
        }
        if (!fired) wrong.push(`${id} never fired on ${JSON.stringify(sample)}`);
    }
    expect(wrong).toEqual([]);
    expect(applied).toBeGreaterThan(400);
});

test("a rule that throws reports nothing for itself, says so, and the others still run", () => {
    const broken: Rule = { id: "broken", kind: "prose", severity: "advice", label: "Broken", why: "Test.", on: true, unit: () => { throw new Error("unit"); }, document: () => { throw new Error("document"); } };
    const failed: string[] = [];
    const found = check(read("It was the the end.\n"), { settings, speller, failed: (rule) => failed.push(rule) }, [broken, ...RULES]);
    expect(found.map((one) => one.rule)).toContain("prose-repeat");
    expect(failed).toEqual(["broken", "broken"]);
});
