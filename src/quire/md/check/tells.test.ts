// Her writing rules, which the site's linter reads posts and pages with (pageTells), and which leave
// her own pages alone. mdQuire used them too until 24 November 2026, when the owner took them out of it.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { dashes, isHers, pageTells, tellsIn, type Tell } from "./tells";

const root = new URL("../../../../", import.meta.url).pathname;
/** The tells the linter finds in a document kept at a path. */
const linter = (path: string, source: string) => [...new Set(pageTells(path, source).map((one) => one.tell))].sort();

test("the linter finds each tell added to any post or page that is not hers, and none in hers", async () => {
    const files = await Array.fromAsync(new Glob("src/content/**/*.{md,mdx}").scan({ cwd: root }));
    expect(files.length).toBeGreaterThan(20);
    const added: [Tell, string][] = [["dash", "It worked — mostly."], ["emoji", "Done 👍🏽 now."], ["keep-out", "A seamless trip."], ["framing", "It is not just a site."]];
    for (const file of files) {
        const source = await Bun.file(`${root}${file}`).text();
        for (const [tell, sentence] of added) expect([file, tell, linter(file, `${source.trimEnd()}\n\n${sentence}\n`).includes(tell)]).toEqual([file, tell, !isHers(file)]);
    }
});

test("her own pages are hers, by their path in the repository", () => {
    expect(isHers("src/content/pages/bio.mdx")).toBe(true);
    expect(isHers("/home/someone/site/src/content/pages/bio.mdx")).toBe(true);
    expect(isHers("src/content/blog/about.mdx")).toBe(false);
    expect(isHers(undefined)).toBe(false);
    expect(pageTells("src/content/pages/bio.mdx", "My journey — here.\n")).toEqual([]);
});

test("a dash between numbers is a range, a spaced hyphen counts in prose and not in code", () => {
    expect(dashes("From 1990–2000 we ran.")).toEqual([]);
    expect(dashes("It worked — mostly.").length).toBe(1);
    expect(dashes("It worked - mostly.").length).toBe(1);
    expect(dashes("x = n - 1 here", false)).toEqual([]);
    expect(tellsIn("not just a comment", false)).toEqual([]);
    expect(tellsIn("a robust journey — 🎉", false)).toEqual(["dash", "emoji", "keep-out"]);
});
