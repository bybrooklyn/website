// What the page does with findings, worked out without the page: which finding is at the cursor,
// the next and the one before, which are shown (not ignored, and not on a word still being typed),
// how they are grouped for the list, and what is kept in the browser (her settings, her own words,
// and what she has ignored in each document). view.ts draws what this decides.

import type { Position } from "../document";
import { DEFAULTS, KINDS, type Finding, type Kind, type Settings } from "./engine";

/** Orders two positions: below zero if `a` is first. */
export function compare(a: Position, b: Position): number {
    for (let index = 0; index < Math.min(a.path.length, b.path.length); index++) if (a.path[index] !== b.path[index]) return a.path[index]! - b.path[index]!;
    return a.path.length - b.path.length || a.offset - b.offset;
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((step, index) => step === b[index]);

/** The finding the cursor is in or touching, the shortest if several are: the word rather than its sentence. */
export function findingAt(findings: Finding[], at: Position): Finding | undefined {
    let best: Finding | undefined;
    for (const one of findings) {
        if (!samePath(one.range.start.path, at.path) || at.offset < one.range.start.offset || at.offset > one.range.end.offset) continue;
        if (!best || one.range.end.offset - one.range.start.offset < best.range.end.offset - best.range.start.offset) best = one;
    }
    return best;
}

/** The next finding after a position, or the one before it (`by` -1), going round at the ends. */
export function nextFinding(findings: Finding[], at: Position, by: 1 | -1): Finding | undefined {
    if (!findings.length) return undefined;
    if (by === 1) return findings.find((one) => compare(one.range.start, at) > 0) ?? findings[0];
    return [...findings].reverse().find((one) => compare(one.range.start, at) < 0) ?? findings[findings.length - 1];
}

/** What she has said to ignore in one document: words, and single findings by their rule and words. */
export interface Ignored {
    words: string[];
    findings: string[];
}

/** The key a single finding is ignored by: its rule and the text it covers. */
export const findingKey = (finding: Finding, text: string) => `${finding.rule}:${text}`;

/** The findings to show: none that are ignored, and no spelling on the word the cursor is still typing. */
export function shownFindings(findings: Finding[], ignored: Ignored, text: (finding: Finding) => string, typing?: Position): Finding[] {
    const words = new Set(ignored.words.map((word) => word.toLowerCase()));
    const keys = new Set(ignored.findings);
    return findings.filter((one) => {
        if (one.word && words.has(one.word.toLowerCase())) return false;
        if (keys.size && keys.has(findingKey(one, text(one)))) return false;
        // a word being typed is not finished: its end is where the cursor is
        if (typing && one.kind === "spelling" && samePath(one.range.start.path, typing.path) && typing.offset >= one.range.start.offset && typing.offset <= one.range.end.offset) return false;
        return true;
    });
}

/** The findings by kind, in the order the list shows kinds, leaving out kinds with none. */
export function byKind(findings: Finding[]): { kind: Kind; findings: Finding[] }[] {
    return KINDS.map((kind) => ({ kind, findings: findings.filter((one) => one.kind === kind) })).filter((group) => group.findings.length);
}

/** What each kind is called in the list and the settings. */
export const KIND_NAMES: Record<Kind, string> = { spelling: "Spelling", markdown: "Markdown tidiness", link: "Links and pictures", prose: "Writing" };

// ---- kept in the browser ----

/** The part of the browser's storage used: localStorage, or a stand-in. */
export interface Keep {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const PREFS = "quire-check";
const OWN = "quire-check-words";
const IGNORED = "quire-check-ignore:";

const readJson = <T>(keep: Keep | undefined, key: string): Partial<T> => {
    try {
        const value = JSON.parse(keep?.getItem(key) ?? "{}");
        return value && typeof value === "object" ? value : {};
    } catch {
        return {};
    }
};
const writeJson = (keep: Keep | undefined, key: string, value: unknown) => {
    try {
        keep?.setItem(key, JSON.stringify(value));
    } catch {
        // a browser that keeps nothing still checks; it forgets the settings when the page goes
    }
};

/** Whether checking is on and how it is set, as kept, with anything missing or wrong taken from the defaults. */
export function loadPrefs(keep: Keep | undefined): { on: boolean; settings: Settings } {
    const kept = readJson<{ on: boolean; settings: Partial<Settings> }>(keep, PREFS);
    const settings = kept.settings ?? {};
    const number = (value: unknown, fallback: number) => (typeof value === "number" && value >= 5 && value <= 1000 ? Math.round(value) : fallback);
    const kinds = { ...DEFAULTS.kinds };
    for (const kind of KINDS) if (typeof settings.kinds?.[kind] === "boolean") kinds[kind] = settings.kinds[kind];
    const rules: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(settings.rules ?? {})) if (typeof on === "boolean") rules[id] = on;
    return {
        on: kept.on === true,
        settings: { kinds, rules, sentence: number(settings.sentence, DEFAULTS.sentence), paragraph: number(settings.paragraph, DEFAULTS.paragraph), dialect: settings.dialect === "gb" ? "gb" : "us" },
    };
}

/** Keeps whether checking is on and how it is set. */
export const savePrefs = (keep: Keep | undefined, prefs: { on: boolean; settings: Settings }) => writeJson(keep, PREFS, prefs);

/** Her own words, added to the dictionary from the popover. */
export function loadOwn(keep: Keep | undefined): Set<string> {
    const kept = readJson<{ words: string[] }>(keep, OWN).words;
    return new Set(Array.isArray(kept) ? kept.filter((word) => typeof word === "string") : []);
}

/** Keeps her own words. */
export const saveOwn = (keep: Keep | undefined, words: Set<string>) => writeJson(keep, OWN, { words: [...words].sort() });

/** What is ignored in one document, by the document's place (its store and id). */
export function loadIgnored(keep: Keep | undefined, documentKey: string): Ignored {
    const kept = readJson<Ignored>(keep, IGNORED + documentKey);
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
    return { words: strings(kept.words), findings: strings(kept.findings) };
}

/** Keeps what is ignored in one document. */
export const saveIgnored = (keep: Keep | undefined, documentKey: string, ignored: Ignored) => writeJson(keep, IGNORED + documentKey, ignored);
