// Mote's sound, heard in headless Chromium with the rule a phone keeps: no sound before the visitor has
// pressed something. Sound left on from a last visit must start at the first press anywhere on the
// page, and with the sound switched off nothing is made at all. Skipped on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";

const here = import.meta.dir;

/** Opens a page with `sounds` on it, kept on or off as if from a last visit, makes a knock before and after a press on the page, and says what the browser's sound was doing. */
async function heard(kept: boolean): Promise<{ made: number; before?: string; after?: string }> {
    const folder = await mkdtemp(join(tmpdir(), "mote-sound-"));
    const tab = await browser({ width: 400, height: 300, args: ["--autoplay-policy=document-user-activation-required"] });
    try {
        await Bun.write(`${folder}/page.ts`, `
import { sounds } from "${here}/sound.ts";
const sound = sounds({ recall: () => ${kept}, keep() {} });
document.body.append(sound.button);
sound.knock(0.6);
window.knock = () => sound.knock(0.6);
window.before = window.made[0]?.state;
`);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
        // every AudioContext the page makes is counted, to see what state it is in
        const counted = `window.made = []; const Real = AudioContext; window.AudioContext = class extends Real { constructor(...given) { super(...given); made.push(this); } };`;
        await Bun.write(`${folder}/page.html`, `<!doctype html><body style="height:300px"><script>${counted}</script><script type="module">${await built.outputs[0]!.text()}</script></body>`);
        await tab.open(`file://${folder}/page.html`);
        await tab.click(200, 200);
        await tab.wait(300);
        await tab.run("knock()");
        expect(tab.errors).toEqual([]);
        return await tab.run("({ made: made.length, before: window.before, after: made[0]?.state })");
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}

test.skipIf(!chromium())("sound left on from a last visit is held back until a press, then starts at the first press anywhere", async () => {
    const { made, before, after } = await heard(true);
    expect(made).toBe(1);
    expect(before).toBe("suspended");
    expect(after).toBe("running");
}, 30_000);

test.skipIf(!chromium())("with the sound off, a press makes no sound at all", async () => {
    expect((await heard(false)).made).toBe(0);
}, 30_000);

if (!chromium()) console.warn("sound.test.ts: no Chromium on this machine, so the sound was not heard.");
