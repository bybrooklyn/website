// What the page does with findings: the one at the cursor, the next and the one before, which are
// shown, how they are grouped, and what is kept in the browser, with anything kept wrongly put back
// to how it starts.

import { expect, test } from "bun:test";
import type { MenuItem } from "../ui";
import { DEFAULTS, type Finding, type Fix } from "./engine";
import { around, byKind, cleanWords, compare, findingLines, FIRST_KINDS, MOST_OWN, sameTogether, findingAt, findingKey, loadIgnored, loadOwn, loadPrefs, nextFinding, saveIgnored, saveOwn, savePrefs, shownFindings, wordsOfText, wordsText, type Keep } from "./findings";

const finding = (path: number[], from: number, to: number, kind: Finding["kind"] = "spelling", word?: string): Finding => ({ rule: kind === "spelling" ? "spelling" : "prose-repeat", kind, severity: "mistake", range: { start: { path, offset: from }, end: { path, offset: to } }, message: "", fixes: [], word });
const at = (path: number[], offset: number) => ({ path, offset });

/** A keep in memory, as localStorage is. */
const memory = (): Keep & { items: Map<string, string> } => {
    const items = new Map<string, string>();
    return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
};

test("positions are ordered by their path and then their offset", () => {
    expect(compare(at([1], 5), at([2], 0))).toBeLessThan(0);
    expect(compare(at([3, 0, 1], 0), at([3, 0], 9))).toBeGreaterThan(0);
    expect(compare(at([1], 5), at([1], 5))).toBe(0);
});

test("the finding at the cursor is the shortest one touching it", () => {
    const sentence = finding([0], 0, 40, "prose");
    const word = finding([0], 10, 15);
    expect(findingAt([sentence, word], at([0], 12))).toBe(word);
    expect(findingAt([sentence, word], at([0], 15))).toBe(word);
    expect(findingAt([sentence, word], at([0], 30))).toBe(sentence);
    expect(findingAt([sentence, word], at([1], 3))).toBeUndefined();
});

test("next and back go round at the ends", () => {
    const all = [finding([0], 2, 4), finding([1], 0, 3), finding([3, 1, 0], 1, 2)];
    expect(nextFinding(all, at([0], 3), 1)).toBe(all[1]);
    expect(nextFinding(all, at([5], 0), 1)).toBe(all[0]);
    expect(nextFinding(all, at([1], 1), -1)).toBe(all[1]);
    expect(nextFinding(all, at([0], 0), -1)).toBe(all[2]);
    expect(nextFinding([], at([0], 0), 1)).toBeUndefined();
});

test("ignored words and findings are not shown, nor the word the cursor is still typing", () => {
    const typo = finding([0], 0, 4, "spelling", "Teh");
    const twice = finding([0], 5, 9, "prose");
    const other = finding([1], 0, 3, "spelling", "wrod");
    const text = (one: Finding) => (one === twice ? " the" : "");
    expect(shownFindings([typo, twice, other], { words: [], findings: [] }, text)).toHaveLength(3);
    expect(shownFindings([typo, twice, other], { words: ["teh"], findings: [findingKey(twice, " the")] }, text)).toEqual([other]);
    expect(shownFindings([typo, twice, other], { words: [], findings: [] }, text, at([1], 3))).toEqual([typo, twice]);
    expect(shownFindings([typo, twice, other], { words: [], findings: [] }, text, at([0], 9))).toEqual([typo, twice, other]);
});

test("findings are grouped by kind in the list's order", () => {
    const groups = byKind([finding([0], 0, 1, "prose"), finding([1], 0, 1), finding([2], 0, 1, "prose")]);
    expect(groups.map((group) => [group.kind, group.findings.length])).toEqual([["spelling", 1], ["prose", 2]]);
});

test("settings, her words and what is ignored are kept, and anything kept wrongly is put back", () => {
    const keep = memory();
    // a writer who never set checking has spelling on, alone, in American
    expect(loadPrefs(keep)).toEqual({ on: true, settings: { ...DEFAULTS, kinds: FIRST_KINDS } });
    expect(FIRST_KINDS).toEqual({ spelling: true, prose: false, markdown: false, link: false });
    savePrefs(keep, { on: true, settings: { ...DEFAULTS, sentence: 25, dialect: "gb", rules: { "prose-passive": true } } });
    expect(loadPrefs(keep)).toEqual({ on: true, settings: { ...DEFAULTS, sentence: 25, dialect: "gb", rules: { "prose-passive": true } } });
    keep.setItem("quire-check", JSON.stringify({ on: "yes", settings: { sentence: -3, dialect: "fr", kinds: { spelling: "no", prose: false }, rules: { x: 1 } } }));
    expect(loadPrefs(keep)).toEqual({ on: true, settings: { ...DEFAULTS, kinds: { ...DEFAULTS.kinds, prose: false } } });
    keep.setItem("quire-check", "not json");
    expect(loadPrefs(keep).on).toBe(true);
    // whoever turned it off keeps it off
    savePrefs(keep, { on: false, settings: DEFAULTS });
    expect(loadPrefs(keep).on).toBe(false);
    saveOwn(keep, new Set(["wgpu", "iroh"]));
    expect([...loadOwn(keep)]).toEqual(["iroh", "wgpu"]);
    saveIgnored(keep, "Browser:one", { words: ["teh"], findings: ["rule:x"] });
    expect(loadIgnored(keep, "Browser:one")).toEqual({ words: ["teh"], findings: ["rule:x"] });
    expect(loadIgnored(keep, "Browser:two")).toEqual({ words: [], findings: [] });
    expect(loadPrefs(undefined).on).toBe(true);
});

test("her dictionary keeps only words: trimmed, each once, no spaces or control characters, none too long", () => {
    expect(cleanWords([" wgpu ", "iroh", "iroh", "", "two words", "tab\tbed", "x".repeat(65), 7, null, "naïve", "zero\u200bwidth"])).toEqual(["wgpu", "iroh", "naïve"]);
    expect(cleanWords(Array.from({ length: MOST_OWN + 50 }, (_, index) => `w${index}`))).toHaveLength(MOST_OWN);
    const keep = memory();
    keep.setItem("quire-check-words", JSON.stringify({ words: ["fine", { evil: true }, "has space", "  ok  "] }));
    expect([...loadOwn(keep)]).toEqual(["fine", "ok"]);
    keep.setItem("quire-check-words", JSON.stringify({ words: "not a list" }));
    expect([...loadOwn(keep)]).toEqual([]);
});

test("her dictionary as a text file: one word to a line, sorted, and read back from lines, commas or tabs", () => {
    expect(wordsText(["wgpu", "Iroh", "apple"])).toBe("apple\nIroh\nwgpu\n");
    expect(wordsOfText("\uFEFFwgpu\r\niroh\n\n  Bazzite  \nlimine,ryzen\tollama\nnot a word\n")).toEqual(["wgpu", "iroh", "Bazzite", "limine", "ryzen", "ollama"]);
    expect(wordsOfText(wordsText(["b", "a"]))).toEqual(["a", "b"]);
});

test("ignoring one finding ignores that one, not every finding of its rule with the same words; keys kept before still work", () => {
    const dash = (offset: number): Finding => ({ rule: "writing-dash", kind: "prose", severity: "mistake", range: { start: { path: [0], offset }, end: { path: [0], offset: offset + 3 } }, message: "A dash.", fixes: [] });
    const text = "One — two. Three — four.";
    const [first, second] = [dash(3), dash(16)];
    const key = (finding: Finding) => around(text, finding.range.start.offset, finding.range.end.offset);
    expect(shownFindings([first, second], { words: [], findings: [findingKey(first, key(first))] }, key)).toEqual([second]);
    // a key kept with only the words, before keys had the text either side
    expect(shownFindings([first, second], { words: [], findings: ["writing-dash: — "] }, key)).toEqual([]);
});

test("the same words found by one rule are one line of the list, in the order first found, whatever their case", () => {
    const text = ["teh", "Teh", "wrod", "teh"];
    const found = [finding([0], 0, 3), finding([1], 0, 3), finding([2], 0, 4), finding([3], 0, 3)];
    const lines = sameTogether(found, (one) => text[one.range.start.path[0]!]!);
    expect(lines.map((line) => line.map((one) => one.range.start.path[0]))).toEqual([[0, 1, 3], [2]]);
});

/** A finding's menu as words: a rule as "|", a quiet line in brackets, a strong one with "*". */
const said = (lines: MenuItem[]) => lines.map((line) => (line.rule ? "|" : line.note ? `(${line.label})` : `${line.strong ? "*" : ""}${line.label}`));
const fix = (label: string): Fix => ({ label, edit: (doc) => doc });

test("a misspelled word's menu is its spellings, at most five and strong, a rule, then Add to dictionary and Ignore in this document, with nothing said in sentences", () => {
    const word = { ...finding([0], 0, 3, "spelling", "teh"), message: '"teh" is not in the dictionary.', suggest: () => ["the", "ten", "tea", "tech", "eh", "te"].map(fix) };
    const done: string[] = [];
    const lines = findingLines(word, "Words not in the dictionary", { fix: (one) => done.push(one.label), add: (one) => done.push(`add ${one}`), ignoreWord: (one) => done.push(`ignore ${one}`), ignore: () => done.push("ignore") });
    expect(said(lines)).toEqual(["*the", "*ten", "*tea", "*tech", "*eh", "|", "Add to dictionary", "Ignore in this document"]);
    expect(lines.slice(-2).map((line) => line.icon)).toEqual(["dictionary", "ignore"]);
    for (const line of lines) line.run();
    expect(done).toEqual(["the", "ten", "tea", "tech", "eh", "add teh", "ignore teh"]);
    expect(said(findingLines({ ...word, suggest: undefined }, "", { fix() {}, add() {}, ignoreWord() {}, ignore() {} }))).toEqual(["(No suggestions)", "|", "Add to dictionary", "Ignore in this document"]);
});

test("any other finding's menu names it in a few words, then its fixes, a rule and Ignore; switching the rule off is not there", () => {
    const twice = { ...finding([0], 4, 7, "prose"), message: '"is" is written twice.', fixes: [fix("Take one out")] };
    const lines = said(findingLines(twice, "A word written twice", { fix() {}, add() {}, ignoreWord() {}, ignore() {} }));
    expect(lines).toEqual(["(A word written twice)", "Take one out", "|", "Ignore"]);
    expect(said(findingLines({ ...twice, fixes: [] }, "Links and pictures that point at nothing", { fix() {}, add() {}, ignoreWord() {}, ignore() {} }))).toEqual(["(Links and pictures that point at nothing)", "|", "Ignore"]);
});
