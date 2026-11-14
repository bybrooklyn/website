// Her writing rules, written once: the editor's checking and the site's linter (which reads posts and
// pages through pageTells) give every post and page of the site the same verdict, as written and with
// each tell added to it, and both leave her own pages alone.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { read } from "../read";
import { check, DEFAULTS } from "./engine";
import { dashes, isHers, pageTells, tellsIn, type Tell } from "./tells";
import { WRITING } from "./writing";

const root = new URL("../../../../", import.meta.url).pathname;
const RULE_TELLS: Record<string, Tell> = { "writing-dash": "dash", "writing-emoji": "emoji", "writing-keep-out": "keep-out", "writing-not-just": "framing" };

/** The tells the editor finds in a document kept at a path. */
const editor = (path: string, source: string) => [...new Set(check(read(source, { mdx: path.endsWith(".mdx") }), { settings: DEFAULTS, document: path }, WRITING).map((one) => RULE_TELLS[one.rule]).filter(Boolean))].sort();
/** The tells the linter finds in the same. */
const linter = (path: string, source: string) => [...new Set(pageTells(path, source).map((one) => one.tell))].sort();

test("every post and page gets the same verdict from the editor and the linter, as written and with each tell added", async () => {
    const files = await Array.fromAsync(new Glob("src/content/**/*.{md,mdx}").scan({ cwd: root }));
    expect(files.length).toBeGreaterThan(20);
    const added: [Tell, string][] = [["dash", "It worked — mostly."], ["emoji", "Done 👍🏽 now."], ["keep-out", "A seamless trip."], ["framing", "It is not just a site."]];
    for (const file of files) {
        const source = await Bun.file(`${root}${file}`).text();
        expect([file, editor(file, source)]).toEqual([file, linter(file, source)]);
        for (const [tell, sentence] of added) {
            const more = `${source.trimEnd()}\n\n${sentence}\n`;
            expect([file, tell, editor(file, more)]).toEqual([file, tell, linter(file, more)]);
            expect([file, tell, editor(file, more).includes(tell)]).toEqual([file, tell, !isHers(file)]);
        }
    }
});

test("her own pages are hers, by their path in the repository", () => {
    expect(isHers("src/content/pages/about.mdx")).toBe(true);
    expect(isHers("/home/someone/site/src/content/pages/about.mdx")).toBe(true);
    expect(isHers("src/content/blog/about.mdx")).toBe(false);
    expect(isHers(undefined)).toBe(false);
    expect(pageTells("src/content/pages/about.mdx", "My journey — here.\n")).toEqual([]);
});

test("a dash between numbers is a range, a spaced hyphen counts in prose and not in code", () => {
    expect(dashes("From 1990–2000 we ran.")).toEqual([]);
    expect(dashes("It worked — mostly.").length).toBe(1);
    expect(dashes("It worked - mostly.").length).toBe(1);
    expect(dashes("x = n - 1 here", false)).toEqual([]);
    expect(tellsIn("not just a comment", false)).toEqual([]);
    expect(tellsIn("a robust journey — 🎉", false)).toEqual(["dash", "emoji", "keep-out"]);
});
