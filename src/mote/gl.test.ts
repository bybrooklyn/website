// Mote's 3D drawing, looked at: a small scene is drawn in headless Chromium and its pixels are read
// back. A shader that does not compile, or one that draws nothing, fails here and not on the site.
// Skipped, with a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";

const here = import.meta.dir;

// What the page does: a red cube in the middle and a white sign beside it, drawn four ways.
const scene = `
import { gl } from "${here}/gl.ts";
import { cube } from "${here}/solids.ts";
const canvas = document.querySelector("canvas");
const view = gl(canvas);
view.size(400, 300);
view.look([0, 2, 9], [0, 0, 0], 30);
view.light([4, 9, 6], [-3, -2, -3], [3, 2, 3]);
view.add(cube(), { color: [0.9, 0.2, 0.2] });
const sign = view.sign("17", [1, 1, 1]);
sign.at = [-2.6, 0, 0];
sign.turn = view.facing();
const g = canvas.getContext("webgl2");
const read = () => {
    view.draw();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    g.readPixels(0, 0, canvas.width, canvas.height, g.RGBA, g.UNSIGNED_BYTE, pixels);
    const at = (x, y) => [...pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    let seen = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) seen++;
    return { middle: at(canvas.width >> 1, canvas.height >> 1), corner: at(2, 2), seen };
};
const plain = read();
sign.emit = 1;
const shining = read();
view.shade = 0.5;
const shaded = read();
window.result = { plain, shining, shaded, wide: canvas.width };
`;

test.skipIf(!chromium())("a cube is drawn, what shines bleeds light, and the shade darkens", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-gl-"));
    const tab = await browser({ width: 500, height: 400 });
    try {
        await Bun.write(`${folder}/scene.ts`, scene);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:400px;height:300px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const { plain, shining, shaded } = await tab.run<Record<"plain" | "shining" | "shaded", { middle: number[]; corner: number[]; seen: number }>>("window.result");

        // the cube is there, solid and red, and nothing is drawn where nothing is
        expect(plain.middle[3]).toBe(255);
        expect(plain.middle[0]!).toBeGreaterThan(plain.middle[1]! * 2);
        expect(plain.corner[3]).toBe(0);
        // a sign that shines lights up pixels around itself that were empty
        expect(shining.seen).toBeGreaterThan(plain.seen + 400);
        // the shade darkens the cube and the empty corner alike
        expect(shaded.corner[3]!).toBeGreaterThan(110);
        expect(shaded.corner[3]!).toBeLessThan(145);
        expect(shaded.middle[0]!).toBeLessThan(shining.middle[0]!);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);

/** Runs a page's script in headless Chromium and gives back what it put in `window.result`. */
async function drawn<T>(script: string): Promise<T> {
    const folder = await mkdtemp(join(tmpdir(), "mote-gl-"));
    const tab = await browser({ width: 500, height: 400 });
    try {
        await Bun.write(`${folder}/scene.ts`, script);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:400px;height:300px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        // (a page that waits on the browser sets its result a moment after it has loaded)
        const result = await tab.run<T>("new Promise((done) => { const look = () => (window.result ? done(window.result) : setTimeout(look, 50)); look(); })");
        expect(tab.errors).toEqual([]);
        return result;
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}

/** Counts the buffers and vertex arrays the page has on the graphics card, as `window.live`. */
const COUNTED = `
const live = (window.live = { buffers: 0, arrays: 0 });
const proto = WebGL2RenderingContext.prototype;
for (const [make, free, name] of [["createBuffer", "deleteBuffer", "buffers"], ["createVertexArray", "deleteVertexArray", "arrays"]]) {
    const [made, freed] = [proto[make], proto[free]];
    proto[make] = function () { live[name]++; return made.call(this); };
    proto[free] = function (thing) { live[name]--; return freed.call(this, thing); };
}
`;

test.skipIf(!chromium())("a part taken away frees what it was drawn from, and the same mesh added again is not made again", async () => {
    const result = await drawn<Record<string, number>>(`
${COUNTED}
import { gl } from "${here}/gl.ts";
import { ball, cube } from "${here}/solids.ts";
const view = gl(document.querySelector("canvas"));
view.size(400, 300);
const empty = live.buffers;
const round = ball(0.3);
const look = { color: [1, 1, 1], marks: (face) => String(face + 1) };
let parts = [view.add(round, { color: [1, 1, 1] }), view.add(cube(), look), view.sign("17", [1, 1, 1])];
view.draw();
const one = live.buffers - empty;
// taken away and put back, again and again, as a board rebuilt on every move of a slider is
for (let i = 0; i < 200; i++) {
    for (const part of parts) view.remove(part);
    parts = [view.add(round, { color: [1, 1, 1] }), view.add(cube(), look), view.sign("17", [1, 1, 1])];
    view.draw();
}
const after = live.buffers - empty;
// many parts of one mesh share one buffer
const many = Array.from({ length: 80 }, () => view.add(round, { color: [1, 0, 0] }));
view.draw();
const shared = live.buffers - empty;
for (const part of [...parts, ...many]) view.remove(part);
view.draw();
window.result = { one, after, shared, gone: live.buffers - empty, arrays: live.arrays };
`);
    // a ball, a cube's faces and a cube's numbers, and a sign: four buffers, and as many after 200 rebuilds
    // (each new cube() is a new mesh, so its two are made again, and the old two freed)
    expect(result.one).toBe(4);
    expect(result.after).toBe(4);
    expect(result.shared).toBe(4);
    // nothing left once every part is gone
    expect(result.gone).toBe(0);
    expect(result.arrays).toBe(0);
}, 30_000);

test.skipIf(!chromium())("four hundred different words, each shown and taken away, are each drawn as themselves", async () => {
    const result = await drawn<{ wrong: number[]; apart: number }>(`
import { gl } from "${here}/gl.ts";
/** A view that shows one word filling the picture, and what that picture is. */
const viewer = (canvas) => {
    const view = gl(canvas);
    view.size(120, 120);
    view.look([0, 0, 2], [0, 0, 0], 30);
    const g = canvas.getContext("webgl2");
    return (word) => {
        const sign = view.sign(word, [1, 1, 1]);
        view.draw();
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        g.readPixels(0, 0, canvas.width, canvas.height, g.RGBA, g.UNSIGNED_BYTE, pixels);
        view.remove(sign);
        return pixels;
    };
};
const fresh = () => {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:120px;height:120px";
    document.body.append(canvas);
    return canvas;
};
const unlike = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
const long = viewer(fresh());
const words = Array.from({ length: 400 }, (_, i) => String(i));
const seen = words.map((word) => long(word));
// a view that has written nothing else draws a few of them, late ones above all, to compare against
const wrong = [];
const once = viewer(fresh());
for (const at of [0, 143, 144, 150, 250, 399]) if (unlike(seen[at], once(words[at])) > 0.5) wrong.push(at);
window.result = { wrong, apart: unlike(seen[150], seen[151]) };
`);
    expect(result.wrong).toEqual([]);
    // and the comparison can tell two words apart
    expect(result.apart).toBeGreaterThan(2);
}, 30_000);

test.skipIf(!chromium())("a context the browser takes away is asked back, and the scene is drawn again when it returns", async () => {
    const result = await drawn<{ before: number[]; restored: boolean; again: number[]; redrawn: number[]; disposed: boolean }>(`
import { gl } from "${here}/gl.ts";
import { cube } from "${here}/solids.ts";
const canvas = document.querySelector("canvas");
const view = gl(canvas);
view.size(400, 300);
view.look([0, 2, 9], [0, 0, 0], 30);
view.light([4, 9, 6], [-3, -2, -3], [3, 2, 3]);
view.add(cube(), { color: [0.9, 0.2, 0.2], marks: (face) => String(face + 1) });
const g = canvas.getContext("webgl2");
const middle = () => {
    const pixel = new Uint8Array(4);
    g.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, pixel);
    return [...pixel];
};
view.draw();
const before = middle();
const lose = g.getExtension("WEBGL_lose_context");
const event = (name) => new Promise((done) => {
    canvas.addEventListener(name, () => done(true), { once: true });
    setTimeout(() => done(false), 3000);
});
const gone = event("webglcontextlost");
lose.loseContext();
await gone;
// (asked back only once the browser has finished telling of the loss)
await new Promise((done) => setTimeout(done, 50));
// what the view drew by itself as the context came back, read in the same moment
let redrawn = [];
const back = new Promise((done) => {
    canvas.addEventListener("webglcontextrestored", () => { redrawn = middle(); done(true); }, { once: true });
    setTimeout(() => done(false), 3000);
});
lose.restoreContext();
const restored = await back;
view.draw();
const again = middle();
view.dispose();
window.result = { before, restored, again, redrawn, disposed: g.isContextLost() };
`);
    expect(result.before[3]).toBe(255);
    expect(result.restored).toBe(true);
    // the same red cube, drawn again with no word from the scene, and on the next draw
    expect(result.redrawn).toEqual(result.before);
    expect(result.again).toEqual(result.before);
    // and a view let go of gives its context back
    expect(result.disposed).toBe(true);
}, 30_000);

test.skipIf(!chromium())("a cube 300 units off is past what the eye sees unless the scene sets a longer range, and the range left alone is as before", async () => {
    const result = await drawn<{ near: number[]; plain: number[]; far: number[] }>(`
import { gl } from "${here}/gl.ts";
import { cube } from "${here}/solids.ts";
const canvas = document.querySelector("canvas");
const view = gl(canvas);
view.size(400, 300);
view.light([4, 9, 6], [-3, -2, -3], [3, 2, 3]);
const part = view.add(cube(), { color: [0.9, 0.2, 0.2] });
const g = canvas.getContext("webgl2");
const middle = () => {
    view.draw();
    const pixel = new Uint8Array(4);
    g.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, pixel);
    return [...pixel];
};
view.look([0, 0, 9], [0, 0, 0], 30);
const near = middle();
part.scale = 40;
view.look([0, 0, 300], [0, 0, 0], 30);
const plain = middle();
view.range = [2, 1000];
const far = middle();
window.result = { near, plain, far };
`);
    expect(result.near[3]).toBe(255);
    expect(result.plain[3]).toBe(0);
    expect(result.far[3]).toBe(255);
}, 30_000);

if (!chromium()) console.warn("gl.test.ts: no Chromium on this machine, so the drawing was not looked at.");
