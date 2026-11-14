// What the table of text models is held to: each file pinned to a commit and a digest, fetched from
// that commit and nowhere else, the three sizes about 6, 38 and 152 MB, and a file shared by two sizes
// kept once. Where the files have been fetched to this machine for trials
// (~/.cache/quire-model-trials/ocr/<repository>/<path>), each is checked against its size and digest;
// without them that part is skipped, with a notice.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { addressOf, fileFor, HOST, keptName, megabytes, sizeOf, tierOf, TIERS } from "./models";

/** Where the trial copies of the models are kept on this machine. */
export const TRIALS = `${homedir()}/.cache/quire-model-trials/ocr`;

test("every file is pinned to a commit and a digest, and fetched from that commit on Hugging Face", () => {
    for (const tier of TIERS)
        for (const each of tier.files) {
            expect(each.revision).toMatch(/^[0-9a-f]{40}$/);
            expect(each.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(each.repo.startsWith("PaddlePaddle/")).toBe(true);
            expect(addressOf(each)).toBe(`${HOST}/${each.repo}/resolve/${each.revision}/${each.path}`);
        }
});

test("the three sizes are about 6, 38 and 152 MB, the smallest first, each with a detector, a recognizer and its dictionary", () => {
    expect(TIERS.map((tier) => megabytes(sizeOf(tier)))).toEqual(["6 MB", "38 MB", "152 MB"]);
    for (const tier of TIERS) for (const role of ["detect", "recognize", "dictionary"] as const) expect(fileFor(tier, role)).toBeDefined();
    expect(fileFor(tierOf("small"), "line")).toBeDefined();
    expect(fileFor(tierOf("large"), "page")).toBeDefined();
    expect(fileFor(tierOf("tiny"), "line")).toBeUndefined();
    expect(tierOf("nothing").id).toBe("tiny");
    expect(tierOf(null).id).toBe("tiny");
});

test("a file two sizes share is kept under one name, and files that differ never share a name", () => {
    const names = new Map<string, string>();
    for (const tier of TIERS)
        for (const each of tier.files) {
            const said = `${each.repo} ${each.revision} ${each.path}`;
            const name = keptName(each);
            expect(names.get(name) ?? said).toBe(said);
            names.set(name, said);
        }
    expect(keptName(fileFor(tierOf("small"), "line")!)).toBe(keptName(fileFor(tierOf("large"), "line")!));
});

test("the trial copies on this machine are the pinned files, byte for byte", async () => {
    let checked = 0;
    for (const tier of TIERS)
        for (const each of tier.files) {
            const kept = Bun.file(`${TRIALS}/${each.repo.slice("PaddlePaddle/".length)}/${each.path}`);
            if (!(await kept.exists())) continue;
            const bytes = new Uint8Array(await kept.arrayBuffer());
            expect(bytes.length).toBe(each.bytes);
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(each.sha256);
            checked++;
        }
    if (!checked) console.warn(`text models not checked: none fetched to ${TRIALS}`);
});
