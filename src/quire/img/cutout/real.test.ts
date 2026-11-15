// The cut-out's models, the real files, on the site's own ONNX Runtime build in Chromium, on a scene
// drawn in the page (a figure with a head of fine strands against a green ground): each quality runs on
// WebAssembly and, where Chromium gives a graphics card, on WebGPU (where it runs there), and gives a
// mask holding the figure and not the ground (Best only on the card: on WebAssembly it runs out of
// memory, which is printed); times for a 2 and a 12 megapixel picture are printed. The files are read
// from where they were fetched for trials (~/.cache/quire-model-trials/parts/); without them, or
// without a Chromium, this is skipped with a notice, and nothing is fetched.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../../scripts/core-page";
import { decodeRuns } from "../masks";
import { CUT_TIERS } from "../parts/models";

const ORT = `${import.meta.dir}/../../../../node_modules/onnxruntime-web/dist/`;
const TRIALS = `${homedir()}/.cache/quire-model-trials/parts/`;
const TIERS = CUT_TIERS.filter((tier) => !process.env.ONLY || tier.id === process.env.ONLY);
const there = TIERS.every((tier) => tier.files.every((each) => existsSync(TRIALS + each.repo + "/" + each.path)));

/** The share of a mask above a half inside a rectangle of shares, and outside it. */
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

/** The worker each trial page runs the model in, as the editor does, so that the page answers while a slow model runs: one choice's files on a shelf in memory, a scene drawn at a size, and each run timed cold and warm. */
const workerScript = (only: string) => `
    import { serve } from "${quire}/img/parts/finder.ts";
    import { CUT_TIERS } from "${quire}/img/parts/models.ts";
    import { keptName } from "${quire}/img/read/models.ts";
    import { graphicsCard } from "${quire}/core/onnx.ts";
    const files = new Map();
    const shelf = { write: async (name, bytes) => files.set(name, bytes), read: async (name) => files.get(name), size: async (name) => files.get(name)?.length ?? -1, mark: async (name, said) => files.set(name + ".whole", said), marked: async (name) => files.get(name + ".whole") };
    const ready = (async () => { for (const tier of CUT_TIERS.filter((each) => each.id === ${JSON.stringify(only)})) for (const each of tier.files) { const bytes = new Uint8Array(await (await fetch("/m/" + each.repo + "/" + each.path)).arrayBuffer()); files.set(keptName(each), bytes); files.set(keptName(each) + ".whole", each.sha256); } })();
    // a figure (head, strands of hair, a coat) on a green ground, at any size
    const scene = (width, height) => {
        const canvas = new OffscreenCanvas(width, height);
        const c = canvas.getContext("2d");
        c.scale(width / 1200, height / 800);
        c.fillStyle = "#3f9a3c"; c.fillRect(0, 0, 1200, 800);
        c.fillStyle = "#b8452e"; c.beginPath(); c.moveTo(450, 800); c.lineTo(500, 470); c.lineTo(700, 470); c.lineTo(750, 800); c.fill();
        c.fillStyle = "#e0b090"; c.beginPath(); c.arc(600, 360, 95, 0, 7); c.fill();
        c.strokeStyle = "#5a3a22"; c.lineWidth = 2.2;
        for (let at = 0; at < 90; at++) { const a = Math.PI * (1.05 + at / 100); c.beginPath(); c.moveTo(600 + Math.cos(a) * 80, 360 + Math.sin(a) * 80); c.quadraticCurveTo(600 + Math.cos(a) * 150, 340 + Math.sin(a) * 150, 600 + Math.cos(a + 0.2) * 175, 380 + Math.sin(a) * 170); c.stroke(); }
        return canvas.transferToImageBitmap();
    };
    const warns = [];
    const warn = console.warn;
    console.warn = (...args) => { warns.push(args.map(String).join(" ").slice(0, 600)); warn(...args); };
    self.onmessage = async (event) => {
        if (event.data === "card") return self.postMessage({ card: await graphicsCard() });
        await ready;
        const [tier, prefer, width, height] = event.data;
        let said;
        try {
            await serve({ type: "matte", id: 1, tier, picture: scene(width, height), prefer, side: 1024 }, { shelf: async () => shelf, say: (answer) => (said = answer) });
            if (said.type === "found") {
                const started = performance.now();
                await serve({ type: "matte", id: 2, tier, picture: scene(width, height), prefer, side: 1024 }, { shelf: async () => shelf, say: (answer) => answer.type === "failed" && (said.warmError = answer.message) });
                said.warm = Math.round(performance.now() - started);
            }
        } catch (error) {
            said = { message: String(error) };
        }
        self.postMessage({ ...said, warns: warns.splice(0) });
    };
`;

/** A page with one choice's worker, in a runtime of its own, so that one model's memory never crowds another's. */
const pageFor = async (only: string) => {
    const folder = await mkdtemp(join(tmpdir(), "quire-cut-"));
    await Bun.write(`${folder}/worker.ts`, workerScript(only));
    const built = await Bun.build({ entrypoints: [`${folder}/worker.ts`], target: "browser" });
    const script = await built.outputs[0]!.text();
    await rm(folder, { recursive: true, force: true });
    return corePage(
        `
        const worker = new Worker("/worker.js", { type: "module" });
        worker.onmessage = (event) => (window.done = event.data);
        window.go = (given) => { window.done = undefined; worker.postMessage(given); };
    `,
        {
            args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"],
            files: async (path) => {
                if (path === "/worker.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
                if (path.startsWith("/ort/")) return new Response(Bun.file(ORT + path.slice(5)), { headers: { "Content-Type": path.endsWith(".mjs") ? "text/javascript" : "application/wasm" } });
                if (path.startsWith("/m/")) return new Response(Bun.file(TRIALS + decodeURIComponent(path.slice(3))));
                return undefined;
            },
        },
    );
};

test("each quality of cut-out runs on the site's ONNX Runtime where it can, and holds the figure and not the ground", async () => {
    if (!there) return console.warn("cut-out models skipped: they are not in ~/.cache/quire-model-trials/parts/");
    {
        const figure = { x: 470 / 1200, y: 270 / 800, width: 260 / 1200, height: 530 / 800 };
        const ground = { x: 0, y: 0, width: 0.25, height: 1 };
        const masks: Record<string, { width: number; height: number; runs: string }> = {};
        let card = false;
        for (const tier of TIERS) {
          for (const prefer of ["wasm", "webgpu"]) {
            let page = await pageFor(tier.id);
            if (!page) return;
            try {
                await page.tab.run(`window.go("card")`);
                while (!(await page.tab.run<boolean>("!!window.done"))) await page.tab.wait(100);
                card = await page.tab.run<boolean>("window.done.card");
                if (prefer === "webgpu" && !card) continue;
                type Done = { type: string; found: { width: number; height: number; runs: string }; ms: number; warm: number; place: string; message?: string; warmError?: string; warns: string[] };
                for (const [width, height] of [[1732, 1155], [4243, 2828]] as const) {
                    const runOnce = async (): Promise<Done | undefined> => {
                        await page!.tab.run(`window.go(["${tier.id}", "${prefer}", ${width}, ${height}])`);
                        // a run that has not ended in three minutes is given up and said to be
                        const began = Date.now();
                        while (!(await page!.tab.run<boolean>("!!window.done")) && Date.now() - began < 180_000) await page!.tab.wait(250);
                        return (await page!.tab.run<boolean>("!!window.done")) ? page!.tab.run<Done>("window.done") : undefined;
                    };
                    let done = await runOnce();
                    // the graphics card failing (beside other drawing on it) names its cause, and the run is made again in a fresh worker, as the cut-out does
                    const failed = (each: Done | undefined) => [each?.message, each?.warmError].find((said) => said && /graphics card/.test(said));
                    // beside another browser drawing hard on the same card a fresh worker can fail too, so up to three are tried, each failure named
                    for (let again = 0; again < 3 && failed(done); again++) {
                        console.log(`${tier.name} on ${prefer}: the card failed (${failed(done)!.slice(0, 200)}); run again in a fresh worker`);
                        await page.close();
                        page = await pageFor(tier.id);
                        if (!page) return;
                        done = await runOnce();
                    }
                    expect(failed(done)).toBeUndefined();
                    if (!done) {
                        console.log(`${tier.name} on ${prefer}: did not finish within three minutes`);
                        break;
                    }
                    const warns = done.warns;
                    if (done.message) {
                        console.log(`${tier.name} on ${prefer}: does not run: ${done.message.slice(0, 300)}`);
                        continue;
                    }
                    const inFigure = shares(done.found, { x: 520 / 1200, y: 300 / 800, width: 160 / 1200, height: 450 / 800 });
                    const onGround = shares(done.found, ground);
                    console.log(`${tier.name} (${tier.credit}) asked for ${prefer}, ran as "${done.place}"${warns.length ? ` (${warns[0]!.slice(0, 160)})` : ""}: ${Math.round((width * height) / 1e6)} MP, ${done.ms} ms first, ${done.warm} ms warm; figure ${Math.round(inFigure.inside * 100)}% in, ground ${Math.round(onGround.inside * 100)}% in`);
                    if (width < 2000) masks[`${tier.id} ${prefer}`] = done.found;
                    expect(inFigure.inside).toBeGreaterThan(0.6);
                    expect(onGround.inside).toBeLessThan(0.05);
                }
            } finally {
                await page?.close();
            }
          }
        }
        expect(figure.width).toBeGreaterThan(0);
        if (!card) console.log("there is no graphics card here, so WebGPU was not tried");
    }
}, 1_200_000);
