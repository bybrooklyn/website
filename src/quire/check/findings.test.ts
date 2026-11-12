// What the page does with findings: the one at the cursor, the next and the one before, which are
// shown, how they are grouped, and what is kept in the browser, with anything kept wrongly put back
// to how it starts.

import { expect, test } from "bun:test";
import { DEFAULTS, type Finding } from "./engine";
import { byKind, compare, findingAt, findingKey, loadIgnored, loadOwn, loadPrefs, nextFinding, saveIgnored, saveOwn, savePrefs, shownFindings, type Keep } from "./findings";

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
    expect(loadPrefs(keep)).toEqual({ on: false, settings: DEFAULTS });
    savePrefs(keep, { on: true, settings: { ...DEFAULTS, sentence: 25, dialect: "gb", rules: { "prose-passive": true } } });
    expect(loadPrefs(keep)).toEqual({ on: true, settings: { ...DEFAULTS, sentence: 25, dialect: "gb", rules: { "prose-passive": true } } });
    keep.setItem("quire-check", JSON.stringify({ on: "yes", settings: { sentence: -3, dialect: "fr", kinds: { spelling: "no", prose: false }, rules: { x: 1 } } }));
    expect(loadPrefs(keep)).toEqual({ on: false, settings: { ...DEFAULTS, kinds: { ...DEFAULTS.kinds, prose: false } } });
    keep.setItem("quire-check", "not json");
    expect(loadPrefs(keep).on).toBe(false);
    saveOwn(keep, new Set(["wgpu", "iroh"]));
    expect([...loadOwn(keep)]).toEqual(["iroh", "wgpu"]);
    saveIgnored(keep, "Browser:one", { words: ["teh"], findings: ["rule:x"] });
    expect(loadIgnored(keep, "Browser:one")).toEqual({ words: ["teh"], findings: ["rule:x"] });
    expect(loadIgnored(keep, "Browser:two")).toEqual({ words: [], findings: [] });
    expect(loadPrefs(undefined).on).toBe(false);
});
