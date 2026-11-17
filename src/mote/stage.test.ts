// What the stage's loop is held to, measured without a browser: how many fixed steps each frame takes
// at the refresh rates screens have, with the jitter real frame times come with. And, in headless
// Chromium, that a press in a mini's panel between its controls leaves the keyboard in the mini.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { TICK, paced } from "./stage";

/** The steps taken by each of `count` frames at `hertz`, each frame's time read up to a tenth of a millisecond off. */
function frames(hertz: number, count = 2000): number[] {
    let [owed, last, seed] = [0, 0, 7];
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0002;
    return Array.from({ length: count }, (_, frame) => {
        const now = (frame + 1) / hertz + jitter();
        const due = paced(owed, now - last);
        [owed, last] = [due.owed, now];
        return due.steps;
    });
}

test("a screen at 60 Hz takes two steps every frame, at 120 Hz one, and at 240 Hz one every other frame", () => {
    expect(new Set(frames(60))).toEqual(new Set([2]));
    expect(new Set(frames(120))).toEqual(new Set([1]));
    const fast = frames(240);
    expect(fast.every((steps, at) => at === 0 || steps + fast[at - 1]! === 1)).toBe(true);
});

test("at any rate the steps keep time with the clock, and no frame takes more than it must", () => {
    for (const hertz of [50, 60, 75, 90, 120, 144, 165, 240]) {
        const taken = frames(hertz);
        const seconds = taken.length / hertz;
        expect(Math.abs(taken.reduce((sum, steps) => sum + steps, 0) * TICK - seconds)).toBeLessThan(2 * TICK);
        expect(Math.max(...taken)).toBe(Math.ceil(120 / hertz - 1e-9));
    }
});

test("a long pause is not made up, and a time that is not a number or runs backward stops nothing for good", () => {
    expect(paced(0, 3).steps).toBe(6);
    for (const bad of [Number.NaN, -1, -Infinity, Infinity]) {
        const after = paced(0, bad);
        expect(after.steps).toBeLessThanOrEqual(6);
        expect(paced(after.owed, 1 / 60).steps).toBeGreaterThan(0);
    }
    expect(paced(Number.NaN, 1 / 60).steps).toBe(2);
});

// In headless Chromium: a press in a mini's panel between its controls keeps the keyboard in the mini,
// on a page whose panel can itself take the keyboard, as an opened page's does.

/** Opens a page with a mini whose panel has a heading, a word out of reach and a word to press, presses the scene and then `where`, and says where the keyboard is and whether a key still reaches the mini. */
async function pressed(where: "heading" | "faint" | "word"): Promise<{ inMini: boolean; heard: boolean }> {
    const folder = await mkdtemp(join(tmpdir(), "mote-stage-"));
    const tab = await browser({ width: 400, height: 400 });
    try {
        await Bun.write(`${folder}/page.ts`, `
import { mote, el } from "${import.meta.dir}/stage.ts";
const host = document.querySelector("#mini");
window.heard = 0;
host.addEventListener("keydown", () => window.heard++);
mote(host, (m) => {
    const faint = el("button", { type: "button", id: "faint", textContent: "redo" });
    faint.inert = true;
    m.panel().append(el("h3", { id: "heading", textContent: "build" }), el("div", {}, faint, el("button", { type: "button", id: "word", textContent: "undo" })));
    return { draw() {}, down() {} };
});
`);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><body><div tabindex="-1"><div id="mini" class="mote" style="width:300px"><style>#mini canvas{display:block;width:300px;height:150px}</style></div></div><script type="module">${await built.outputs[0]!.text()}</script></body>`);
        await tab.open(`file://${folder}/page.html`);
        await tab.click(150, 75);
        const at = await tab.run<{ x: number; y: number }>(`(() => { const r = document.getElementById(${JSON.stringify(where)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await tab.click(at.x, at.y);
        await tab.press("r");
        expect(tab.errors).toEqual([]);
        return { inMini: await tab.run<boolean>("document.getElementById('mini').contains(document.activeElement)"), heard: (await tab.run<number>("heard")) > 0 };
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}

test.skipIf(!chromium())("a press on a panel's heading or on a word that cannot act leaves the keyboard in the mini, as a press on a word does", async () => {
    for (const where of ["heading", "faint", "word"] as const) expect(await pressed(where)).toEqual({ inMini: true, heard: true });
}, 60_000);
