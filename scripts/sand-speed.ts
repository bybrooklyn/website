// How long a step of the sand engine takes in the browser: the worlds of sand/examples/speed.rs (a forest
// fire across a full world, a full world of falling sand, a dam of water let go, a settled world with one
// small pour), run in the built
// modules, with SIMD and without, in headless Chromium. Run with `bun scripts/sand-speed.ts`, after
// `bun run wasm`; to hold it to four cores, `taskset -c 0-3 bun scripts/sand-speed.ts`. Two paths after
// it measure two other builds in their place, the first called "with SIMD" and the second "without".

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser } from "./browser";
import { at } from "./lib";

/** What runs in the page: each world built through the module's own functions, each step timed. */
const page = (simd: string, scalar: string) => `<!doctype html><script>
const bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const modules = { "with SIMD": bytes("${simd}"), "without SIMD": bytes("${scalar}") };
const [SAND, WATER, STONE, DIRT, WOOD, FIRE] = [1, 2, 3, 4, 8, 13];
const W = 1024, H = 576;
// the forest of sand/examples/speed.rs: a floor of dirt and trees every 9 cells, each a trunk and a crown
function forest(e) {
    e.create(W, H, 1, 0);
    e.paint(DIRT, 0, H - 6, W - 1, H - 1, 3, 100, 0);
    for (let x = 6, k = 0; x < W - 4; x += 9, k++) {
        const top = 220 + ((k * 7) % 5) * 2;
        e.paint(WOOD, x, top, x, H - 8, 1, 100, 0);
        e.paint(WOOD, x, top, x, top, 4, 100, 0);
    }
}
function time(e, n, between) {
    let total = 0, slowest = 0;
    for (let k = 0; k < n; k++) {
        between?.(e);
        const start = performance.now();
        e.step(1);
        const took = performance.now() - start;
        total += took;
        slowest = Math.max(slowest, took);
    }
    return { mean: total / n, slowest };
}
function settled(e) {
    e.create(W, H, 1, 0);
    for (let x = 0; x < W; x += 64) e.paint(x % 128 === 0 ? SAND : DIRT, x + 32, H - 60, x + 32, H - 60, 40, 100, 0);
    e.paint(STONE, 100, 300, 400, 330, 3, 100, 0);
    e.paint(STONE, 600, 250, 900, 240, 3, 100, 0);
    e.paint(WATER, 700, 150, 800, 150, 30, 100, 0);
    let steps = 0;
    while (e.awake() > 0 && steps < 20000) { e.step(1); steps++; }
    e.step(1);
}
window.results = (async () => {
    const out = {};
    for (const [name, code] of Object.entries(modules)) {
        const fresh = async () => (await WebAssembly.instantiate(code, {})).instance.exports;
        const rows = {};
        let e = await fresh();
        forest(e);
        rows["a forest fire lit all along, the first 1200 steps"] = time(e, 1200, (w) => {
            if (w.steps() < 40) w.paint(FIRE, 0, H - 14, W - 1, H - 14, 2, 30, 0);
        });
        e = await fresh();
        e.create(W, H, 1, 0);
        for (let y = 0; y < H; y++) e.paint(SAND, 0, y, W - 1, y, 0, 50, 0);
        rows["falling sand, the first 120 steps"] = time(e, 120);
        e = await fresh();
        e.create(W, H, 1, 0);
        for (let y = 100; y < H; y++) e.paint(WATER, 0, y, W / 2, y, 0, 100, 0);
        rows["a dam of water let go, the first 300 steps"] = time(e, 300);
        e = await fresh();
        settled(e);
        rows["settled, sand poured in one place"] = time(e, 600, (w) => w.paint(SAND, 300, 40, 300, 40, 3, 50, 0));
        e = await fresh();
        settled(e);
        rows["settled, water poured into the lake"] = time(e, 600, (w) => w.paint(WATER, 750, 100, 750, 100, 3, 50, 0));
        e = await fresh();
        settled(e);
        rows["settled, nothing touched"] = time(e, 600);
        out[name] = rows;
    }
    return out;
})();
</script>`;

const read = async (path: string) => Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
const [first = at("public/wasm/sand.wasm"), second = at("public/wasm/sand-scalar.wasm")] = process.argv.slice(2);
const folder = await mkdtemp(join(tmpdir(), "sand-speed-"));
const tab = await browser();
try {
    await Bun.write(`${folder}/page.html`, page(await read(first), await read(second)));
    await tab.open(`file://${folder}/page.html`);
    const results = await tab.run<Record<string, Record<string, { mean: number; slowest: number }>>>("window.results");
    if (tab.errors.length > 0) throw new Error(tab.errors.join("; "));
    for (const [build, rows] of Object.entries(results)) {
        console.log(`in Chromium, ${build}:`);
        for (const [name, { mean, slowest }] of Object.entries(rows)) console.log(`  ${name.padEnd(46)} ${mean.toFixed(3).padStart(7)} ms a step, slowest ${slowest.toFixed(3).padStart(7)} ms, ${Math.round(1000 / mean).toString().padStart(6)} steps a second`);
    }
} finally {
    await tab.close();
    await rm(folder, { recursive: true, force: true });
}
