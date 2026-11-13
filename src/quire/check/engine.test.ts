// The engine: rules switched on and off by kind and by id, findings in reading order with their
// paths, a checker that looks again only at what changed and finds exactly what a full check finds,
// work done in slices that keep to their budget and always move on, a document of 124,000 words checked
// again after an edit in a few milliseconds, and a fix that is one edit.

import { expect, test } from "bun:test";
import { insertText, textAt, type Document } from "../document";
import { read } from "../read";
import { write } from "../write";
import { check, createChecker, DEFAULTS, replaceWith, ruleOn, type Rule } from "./engine";
import { unpackDictionary } from "./dictionary";
import { RULES } from "./rules";
import { createSpeller } from "./spelling";

let looked = 0;
/** A rule that flags every "bad", and counts the units it was asked about. */
const bad: Rule = {
    id: "bad",
    kind: "prose",
    severity: "advice",
    label: "Bad",
    why: "Test.",
    on: true,
    unit(unit) {
        looked++;
        return [...unit.read.text.matchAll(/bad/g)].map((match) => ({ from: match.index, to: match.index + 3, message: "Bad.", fixes: [replaceWith("Good", "good")] }));
    },
};
/** A document rule: the number of headings, said at the first. */
const headings: Rule = {
    id: "headings",
    kind: "markdown",
    severity: "advice",
    label: "Headings",
    why: "Test.",
    on: false,
    document(_doc, units) {
        const first = units.find((unit) => unit.heading);
        return first ? [{ rule: "headings", kind: "markdown", severity: "advice", range: { start: { path: first.path, offset: 0 }, end: { path: first.path, offset: 1 } }, message: `${units.filter((unit) => unit.heading).length}`, fixes: [] }] : [];
    },
};
const context = { settings: DEFAULTS };
const doc = read("# Title\n\nA bad line.\n\n- one bad\n- two\n\n| a | bad |\n| - | - |\n| bad | x |\n\n```\nbad code\n```\n");

test("findings come in reading order, with the paths of paragraphs, list items and cells; code is a unit too", () => {
    const found = check(doc, context, [bad]);
    expect(found.map((one) => `${one.range.start.path.join(".")}:${one.range.start.offset}`)).toEqual(["1:2", "2.0.0:4", "3.0.1:0", "3.1.0:0", "4:0"]);
});

test("rules are switched by kind and by id, and start as they say", () => {
    expect(ruleOn(headings, DEFAULTS)).toBe(false);
    expect(ruleOn(headings, { ...DEFAULTS, rules: { headings: true } })).toBe(true);
    expect(ruleOn(bad, { ...DEFAULTS, kinds: { ...DEFAULTS.kinds, prose: false } })).toBe(false);
    expect(check(doc, { settings: { ...DEFAULTS, rules: { headings: true, bad: false } } }, [bad, headings]).map((one) => one.message)).toEqual(["1"]);
});

test("after an edit only the changed unit is looked at again, and the findings equal a full check", () => {
    const checker = createChecker([bad, headings]);
    const settings = { ...DEFAULTS, rules: { headings: true } };
    let now: Document = doc;
    const run = (value: Document) => {
        const job = checker.start(value, { settings });
        let out;
        while (!(out = job.run(() => Infinity)));
        return out;
    };
    run(now);
    // a run of edits: typing, a new block above everything, a block taken away
    const edits: ((value: Document) => Document)[] = [
        (value) => insertText(value, { path: [1], offset: 0 }, "bad "),
        (value) => read(`Fresh bad start\n\n${write(value)}`),
        (value) => ({ ...value, blocks: value.blocks.filter((_, index) => index !== 2) }),
        (value) => insertText(value, { path: [2, 1, 0], offset: 3 }, " bad"),
    ];
    for (const edit of edits) {
        now = edit(now);
        looked = 0;
        const found = run(now);
        const changed = looked;
        const full = check(now, { settings }, [bad, headings]);
        expect(JSON.stringify(found.map(({ fixes, ...rest }) => rest))).toBe(JSON.stringify(full.map(({ fixes, ...rest }) => rest)));
        // a block taken away changes nothing; the rest change one unit each
        expect(changed).toBeLessThanOrEqual(1);
    }
});

test("a job stops when there is no time left and carries on where it was", () => {
    const big = read(Array.from({ length: 200 }, (_, index) => `Line ${index} is bad.`).join("\n\n"));
    const job = createChecker([bad]).start(big, context);
    let slices = 0;
    let out;
    while (!(out = job.run(() => (slices++ % 2 === 0 ? 5 : 0))));
    expect(out.length).toBe(200);
    expect(slices).toBeGreaterThan(5);
});

test("a fix is an edit of the finding's range, keeping the text around it", () => {
    const [first] = check(read("A bad line.\n"), context, [bad]);
    const fixed = first!.fixes[0]!.edit(read("A bad line.\n"), first!.range);
    expect(textAt(fixed, [0])).toBe("A good line.");
    expect(textAt(replaceWith("Remove", "").edit(read("A bad line.\n"), first!.range), [0])).toBe("A  line.");
});

test("a job always moves on, even when it is given no time at all", () => {
    const big = read(Array.from({ length: 50 }, (_, index) => `Line ${index} is bad.`).join("\n\n"));
    const job = createChecker([bad, headings]).start(big, { settings: { ...DEFAULTS, rules: { headings: true } } });
    let out;
    let runs = 0;
    while (!(out = job.run(() => 0)) && runs < 1000) runs++;
    expect(out?.length).toBe(50);
});

// the site's own prose, a paragraph to a line, 5,000 times: about 124,000 words in 3,400 blocks
const root = new URL("../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());
const lines = (await Bun.file(`${root}src/content/blog/five-versions-of-this-site.mdx`).text()).split("\n").filter((line) => line.length > 60 && !/^(import|<|```)/.test(line));
const long = read(Array.from({ length: 5000 }, (_, index) => `${lines[index % lines.length]}${index % 3 === 0 ? " Extra words here to vary." : ""}`).join("\n\n"));

test("every rule over 124,000 words, in slices of 8 ms: slices keep to their budget, and one block edited is checked again in a few milliseconds", () => {
    const context = { settings: DEFAULTS, speller: createSpeller(words, "us") };
    const checker = createChecker(RULES);
    const sliced = (value: Document) => {
        const job = checker.start(value, context);
        const slices: number[] = [];
        let out;
        for (;;) {
            const start = performance.now();
            out = job.run(() => start + 8 - performance.now());
            slices.push(performance.now() - start);
            if (out) break;
        }
        return { slices, total: slices.reduce((sum, one) => sum + one, 0), longest: Math.max(...slices) };
    };
    const cold = sliced(long);
    const blocks = long.blocks.slice();
    const middle = blocks.findIndex((block, index) => index > blocks.length / 2 && block.kind === "paragraph");
    blocks[middle] = { kind: "paragraph", runs: [{ kind: "text", text: "Teh edited paragraph.", marks: [] }], gap: "\n" };
    const edited = sliced({ ...long, blocks });
    console.info(`124,000 words: cold ${cold.total.toFixed(0)} ms in ${cold.slices.length} slices, longest ${cold.longest.toFixed(1)} ms; one block edited ${edited.total.toFixed(1)} ms, longest slice ${edited.longest.toFixed(1)} ms`);
    // nearly every slice inside its 8 ms; none, on a busy machine, as long as a frame
    const over = cold.slices.filter((one) => one > 8).length;
    expect(over / cold.slices.length).toBeLessThan(0.1);
    expect(cold.longest).toBeLessThan(16);
    expect(edited.total).toBeLessThan(12);
}, 30_000);
