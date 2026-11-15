// The part models, the real files, on the site's own ONNX Runtime build in Chromium, on a scene drawn
// in the page (a sky, a ground, and a figure in a red coat): each choice loads on WebAssembly and, where
// Chromium gives a graphics card, on WebGPU; a press on the figure outlines it (most of the figure in
// the mask, the sky far from it out); a press on the sky and an Alt-press on the figure give the sky
// without the figure; and the subject model gives a mask of the picture's shape. Times are printed.
// The files are read from where they were fetched for trials (~/.cache/quire-model-trials/parts/);
// without them, or without a Chromium, this is skipped with a notice, and nothing is fetched.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { corePage, quire } from "../../../../scripts/core-page";
import { decodeRuns } from "../masks";
import { PART_TIERS } from "./models";

const ORT = `${import.meta.dir}/../../../../node_modules/onnxruntime-web/dist/`;
const TRIALS = `${homedir()}/.cache/quire-model-trials/parts/`;
const there = PART_TIERS.every((tier) => tier.files.every((each) => existsSync(TRIALS + each.repo + "/" + each.path)));

/** Shares of a found mask (as runs) above a half inside and outside a rectangle given as shares of the picture. */
function shares(found: { width: number; height: number; runs: string }, box: { x: number; y: number; width: number; height: number }) {
    const values = decodeRuns(found.runs, found.width * found.height)!;
    let inside = 0;
    let insideOn = 0;
    let outside = 0;
    let outsideOn = 0;
    for (let y = 0; y < found.height; y++)
        for (let x = 0; x < found.width; x++) {
            const u = (x + 0.5) / found.width;
            const v = (y + 0.5) / found.height;
            const on = values[y * found.width + x]! > 127;
            if (u >= box.x && u <= box.x + box.width && v >= box.y && v <= box.y + box.height) ((inside += 1), (insideOn += on ? 1 : 0));
            else ((outside += 1), (outsideOn += on ? 1 : 0));
        }
    return { inside: insideOn / inside, outside: outsideOn / outside };
}

test("each choice of part models runs on the site's ONNX Runtime, on WebAssembly and on the card where there is one, and outlines a figure pressed and the sky without it", async () => {
    if (!there) return console.warn("part models skipped: they are not in ~/.cache/quire-model-trials/parts/");
    const page = await corePage(
        `
        import { serve } from "${quire}/img/parts/engine.ts";
        import { PART_TIERS } from "${quire}/img/parts/models.ts";
        import { keptName } from "${quire}/img/read/models.ts";
        import { graphicsCard } from "${quire}/core/onnx.ts";
        // the trial copies on a shelf in memory, marked whole, as the browser's private storage would keep them
        const files = new Map();
        const shelf = { write: async (name, bytes) => files.set(name, bytes), read: async (name) => files.get(name), size: async (name) => files.get(name)?.length ?? -1, mark: async (name, said) => files.set(name + ".whole", said), marked: async (name) => files.get(name + ".whole") };
        for (const tier of PART_TIERS) for (const each of tier.files) { const bytes = new Uint8Array(await (await fetch("/m/" + each.repo + "/" + each.path)).arrayBuffer()); files.set(keptName(each), bytes); files.set(keptName(each) + ".whole", each.sha256); }
        const scene = () => {
            const canvas = new OffscreenCanvas(1200, 800);
            const c = canvas.getContext("2d");
            c.fillStyle = "#8fb3d9"; c.fillRect(0, 0, 1200, 460);
            c.fillStyle = "#5d6b35"; c.fillRect(0, 460, 1200, 340);
            c.fillStyle = "#b8452e"; c.fillRect(520, 300, 160, 280);
            c.fillStyle = "#e0b090"; c.beginPath(); c.arc(600, 250, 50, 0, 7); c.fill();
            c.fillStyle = "#2b2b3a"; c.fillRect(535, 580, 55, 180); c.fillRect(610, 580, 55, 180);
            return canvas.transferToImageBitmap();
        };
        window.card = () => graphicsCard();
        // why a choice would not load on the card, as the engine says it
        window.warns = [];
        const warn = console.warn;
        console.warn = (...args) => { window.warns.push(args.map(String).join(" ").slice(0, 600)); warn(...args); };
        window.find = async (tier, prefer, kind, presses, card) => {
            let said;
            await serve(kind === "matte" ? { type: "matte", id: 1, tier, picture: scene(), prefer, card } : { type: "select", id: 1, tier, key: tier + prefer + JSON.stringify(presses) + card, picture: scene(), presses, prefer, card }, { shelf: async () => shelf, say: (answer) => (said = answer) });
            if (said.type !== "found") return said;
            // again, with the encoding kept, to time a press after the first
            if (kind !== "matte") { const started = performance.now(); await serve({ type: "select", id: 2, tier, key: tier + prefer + JSON.stringify(presses) + card, presses, prefer, card }, { shelf: async () => shelf, say: () => {} }); said.again = Math.round(performance.now() - started); }
            return said;
        };
    `,
        {
            args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"],
            files: async (path) => {
                if (path.startsWith("/ort/")) return new Response(Bun.file(ORT + path.slice(5)), { headers: { "Content-Type": path.endsWith(".mjs") ? "text/javascript" : "application/wasm" } });
                if (path.startsWith("/m/")) return new Response(Bun.file(TRIALS + decodeURIComponent(path.slice(3))));
                return undefined;
            },
        },
    );
    if (!page) return;
    try {
        const card = await page.tab.run<boolean>("window.card()");
        const figure = { x: 520 / 1200, y: 200 / 800, width: 160 / 1200, height: 560 / 800 };
        for (const tier of PART_TIERS) {
            for (const prefer of card ? ["wasm", "webgpu"] : ["wasm"]) {
                const one = await page.tab.run<{ type: string; found: { width: number; height: number; runs: string }; ms: number; again: number; place: string; message?: string }>(`window.find("${tier.id}", "${prefer}", "select", [{ x: 600, y: 420, add: true }])`);
                expect(one.message).toBeUndefined();
                // on the card only the image encoder runs there; the rest is on WebAssembly, where it runs right
                expect(one.place).toBe(prefer === "webgpu" ? "encode webgpu, decode wasm, matte wasm" : "encode wasm, decode wasm, matte wasm");
                expect(await page.tab.run<string[]>("window.warns")).toEqual([]);
                const coat = shares(one.found, { x: 530 / 1200, y: 310 / 800, width: 140 / 1200, height: 260 / 800 });
                const far = shares(one.found, { x: 0, y: 0, width: 0.3, height: 0.5 });
                console.log(`${tier.name} (${tier.credit}) on ${prefer}: a press on the figure, ${one.ms} ms with its encoding, ${one.again} ms after; the coat ${Math.round(coat.inside * 100)}% in, the far sky ${Math.round(far.inside * 100)}% in`);
                expect(coat.inside).toBeGreaterThan(0.8);
                expect(far.inside).toBeLessThan(0.1);
                const sky = await page.tab.run<{ found: { width: number; height: number; runs: string } }>(`window.find("${tier.id}", "${prefer}", "select", [{ x: 200, y: 150, add: true }, { x: 1000, y: 150, add: true }, { x: 600, y: 420, add: false }])`);
                const skyShares = shares(sky.found, { x: 0, y: 0, width: 1, height: 0.5 });
                const inFigure = shares(sky.found, { x: 530 / 1200, y: 320 / 800, width: 140 / 1200, height: 120 / 800 });
                expect(skyShares.inside).toBeGreaterThan(0.85);
                expect(inFigure.inside).toBeLessThan(0.1);
                console.log(`  the sky pressed twice and the figure taken away: the sky ${Math.round(skyShares.inside * 100)}% in, the coat ${Math.round(inFigure.inside * 100)}% in`);
                const matte = await page.tab.run<{ type: string; found: { width: number; height: number; runs: string }; ms: number; message?: string }>(`window.find("${tier.id}", "${prefer}", "matte", [])`);
                expect(matte.message).toBeUndefined();
                expect([matte.found.width, matte.found.height]).toEqual([512, 341]);
                const subject = shares(matte.found, figure);
                console.log(`  the subject model: ${matte.ms} ms; the figure ${Math.round(subject.inside * 100)}% in, the rest ${Math.round(subject.outside * 100)}% in`);
                expect(subject.inside).toBeGreaterThan(0.6);
                expect(subject.outside).toBeLessThan(0.1);
            }
        }
        if (!card) console.log("there is no graphics card here, so WebGPU was not tried");
    } finally {
        await page.close();
    }
}, 600_000);
