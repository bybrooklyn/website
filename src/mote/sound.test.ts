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

test.skipIf(!chromium())("the sound word keeps the room of its wider words in a line of the marble run's column, so that the word after it does not move when it is pressed", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-sound-"));
    const tab = await browser({ width: 400, height: 300 });
    try {
        await Bun.write(`${folder}/page.ts`, `
import { sounds } from "${here}/sound.ts";
const sound = sounds({ recall: () => false, keep() {} });
const after = document.createElement("button");
after.textContent = "keys";
document.querySelector(".marbles-words").append(sound.button, after);
window.press = () => sound.button.click();
window.where = () => after.getBoundingClientRect().left;
`);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
        const css = await Bun.file(`${here}/../styles/minis.css`).text();
        // in a font of letters all one width, so that which of the two words is wider is plain: "sound: off"
        await Bun.write(`${folder}/page.html`, `<!doctype html><style>${css} button { font: 16px monospace; }</style><body><div class="marbles-words"></div><script type="module">${await built.outputs[0]!.text()}</script></body>`);
        await tab.open(`file://${folder}/page.html`);
        const before = await tab.run<number>("where()");
        await tab.run("press()");
        const on = await tab.run<number>("where()");
        await tab.run("press()");
        expect(tab.errors).toEqual([]);
        expect(on).toBe(before);
        expect(await tab.run<number>("where()")).toBe(before);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);

if (!chromium()) console.warn("sound.test.ts: no Chromium on this machine, so the sound was not heard.");

// The strikes, rendered in headless Chromium by the browser's own offline audio from the same code
// that is heard live, and measured: each sounds and never clips; a chime bar rings at its note and
// dies away; a harder strike is louder; and a hundred marbles' worth of strikes, three a frame for
// three seconds, keep to the limit of voices and stay under full scale through the limiter.

/** Renders a page's offline audio, given a body of code that has `voice`, `hissOf`, `busOf`, `voices` and an `OfflineAudioContext` named `audio` to hand, and gives back what the code returns. */
async function rendered<T>(body: string): Promise<T> {
    const folder = await mkdtemp(join(tmpdir(), "mote-strike-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(`${folder}/page.ts`, `
import { busOf, hissOf, shaped, voice, voices, VOICES } from "${here}/sound.ts";
(window as unknown as { go: () => Promise<unknown> }).go = async () => {
    ${body}
};
`);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><body><script type="module">${await built.outputs[0]!.text()}</script></body>`);
        await tab.open(`file://${folder}/page.html`);
        const result = await tab.run<T>("go()");
        expect(tab.errors).toEqual([]);
        return result;
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}

/** Code for the page: how strong a wave of `f` hertz is in samples from `from` to `to` seconds (Goertzel's way), and the loudest sample. */
const measures = `
const rate = 48000;
const strength = (samples: Float32Array, f: number, from: number, to: number) => {
    const [a, b] = [Math.floor(from * rate), Math.min(samples.length, Math.floor(to * rate))];
    const k = 2 * Math.cos((2 * Math.PI * f) / rate);
    let [s1, s2] = [0, 0];
    for (let i = a; i < b; i++) [s1, s2] = [samples[i]! + k * s1 - s2, s1];
    return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (b - a);
};
const peak = (samples: Float32Array) => samples.reduce((most, x) => Math.max(most, Math.abs(x)), 0);
const one = async (kind: string, hard: number, pitch?: number) => {
    const audio = new OfflineAudioContext(1, rate * 3, rate);
    voice(audio, audio.destination, 0, kind as never, hard, hissOf(audio), pitch);
    return (await audio.startRendering()).getChannelData(0);
};
`;

test.skipIf(!chromium())("every strike sounds and stays under full scale, and a harder strike is louder", async () => {
    const found = await rendered<Record<string, [number, number]>>(`${measures}
const out: Record<string, [number, number]> = {};
for (const kind of ["wood", "glass", "metal", "chime", "bell", "drum"]) out[kind] = [peak(await one(kind, 0.3)), peak(await one(kind, 1))];
return out;`);
    for (const [kind, [soft, hard]] of Object.entries(found)) {
        expect(soft, kind).toBeGreaterThan(0.005);
        expect(hard, kind).toBeLessThan(1);
        expect(hard, kind).toBeGreaterThan(soft * 1.3);
    }
}, 30_000);

test.skipIf(!chromium())("a chime bar rings at its note, nothing a semitone either side, and dies away", async () => {
    const found = await rendered<{ at: number; below: number; above: number; early: number; late: number }[]>(`${measures}
const out = [];
for (const f of [523.25, 784, 1046.5, 1568]) {
    const samples = await one("chime", 0.7, f);
    out.push({ at: strength(samples, f, 0.05, 0.45), below: strength(samples, f / 1.0595, 0.05, 0.45), above: strength(samples, f * 1.0595, 0.05, 0.45), early: strength(samples, f, 0, 0.1), late: strength(samples, f, 1.0, 1.1) });
}
return out;`);
    for (const one of found) {
        expect(one.at).toBeGreaterThan(20 * one.below);
        expect(one.at).toBeGreaterThan(20 * one.above);
        expect(one.late).toBeLessThan(one.early / 3);
        expect(one.late).toBeGreaterThan(0);
    }
}, 30_000);

test.skipIf(!chromium())("a hundred marbles' worth of strikes keep to the limit of voices and never clip", async () => {
    const found = await rendered<{ peak: number; most: number; made: number; dropped: number; seconds: number }>(`${measures}
const audio = new OfflineAudioContext(1, rate * 3, rate);
const bus = busOf(audio);
const noise = hissOf(audio);
const room = voices();
let most = 0;
let seed = 3;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const kinds = ["wood", "wood", "wood", "glass", "glass", "metal", "chime", "bell", "drum"];
// three strikes a frame of a sixtieth of a second, as a hundred marbles rolling and landing give
for (let frame = 0; frame < 170; frame++) {
    for (let k = 0; k < 3; k++) {
        const kind = kinds[Math.floor(next() * kinds.length)];
        const hard = 0.3 + 0.7 * next();
        const time = frame / 60 + next() / 60;
        if (!room.room(time, shaped(kind as never, hard).loud)) continue;
        room.add(voice(audio, bus, time, kind as never, hard, noise, kind === "chime" ? 523.25 * 2 ** (Math.floor(next() * 8) / 12) : undefined), time);
        most = Math.max(most, room.live.length);
    }
}
const before = performance.now();
const samples = (await audio.startRendering()).getChannelData(0);
return { peak: peak(samples), most, made: room.counts.made, dropped: room.counts.dropped, seconds: (performance.now() - before) / 1000 };`);
    console.log(`510 strikes in 3 s: ${found.made} sounded, ${found.dropped} left out or cut short, at most ${found.most} at once; the loudest sample ${found.peak.toFixed(3)}; rendered in ${found.seconds.toFixed(2)} s`);
    expect(found.most).toBeLessThanOrEqual(14);
    expect(found.peak).toBeLessThan(1);
    expect(found.peak).toBeGreaterThan(0.05);
}, 30_000);
