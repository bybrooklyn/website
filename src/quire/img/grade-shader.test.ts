// What the grade on the card is held to: the packed run says where each grade starts and holds its
// numbers, curve and look where the shaders read them; and in Chromium a picture graded by every kind
// of control at once, with a part blended by a mask turned inside out, flattens through WebGL2 to the
// same pixels as the reference arithmetic done here, to within one, through a crop and a resize, and
// through WebGPU to the same pixels as through WebGL2, to within one.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { plan, weight, type Pass } from "./draw";
import { gradeOne, lutData, neutral, prepare, space, type Grade } from "./grade";
import { maskReader, pack, ROW } from "./grade-shader";
import { look, type Look } from "./steps";
import { underLimit } from "../../../scripts/speed";

const original = { name: "pictures/a.png", width: 300, height: 200, type: "image/png", bytes: 1 };

/** A look of 9 a side that bends every color a little: a gentle S on each channel and a warm push. */
function bentLook() {
    const values: number[] = [];
    for (let b = 0; b < 9; b++) for (let g = 0; g < 9; g++) for (let r = 0; r < 9; r++) values.push(...[r, g, b].map((each, channel) => { const x = each / 8; return Math.min(1, x * x * (3 - 2 * x) * 0.6 + x * 0.4 + (channel === 0 ? 0.03 : channel === 2 ? -0.03 : 0)); }));
    return { kind: "3d" as const, size: 9, low: [0, 0, 0] as [number, number, number], high: [1, 1, 1] as [number, number, number], data: lutData(values) };
}

const everything: Grade = {
    ...neutral(),
    light: 30,
    contrast: 40,
    shadows: 30,
    highs: -40,
    warmth: 25,
    tint: -10,
    color: 50,
    curves: { all: [{ x: 0, y: 0.04 }, { x: 0.45, y: 0.5 }, { x: 1, y: 0.97 }], red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }], green: neutral().curves.green, blue: neutral().curves.blue },
    wheels: { shadows: { x: 0.3, y: -0.2 }, mids: { x: -0.1, y: 0.4 }, highs: { x: 0, y: 0.2 } },
    colors: [{ hue: 210, shift: 30, saturation: 40, lightness: -20 }],
    lut: bentLook(),
};
const part: Grade = { ...neutral(), light: -60, color: -30 };
const MASK = { width: 60, height: 40 };
/** A soft round mask, the same in the page and here. */
const maskValue = (x: number, y: number) => Math.max(0, Math.min(1, 1.5 - Math.hypot(x - 30, y - 20) / 10));

test("the packed run says where each grade starts and holds its numbers, curve and look where the shaders read them", () => {
    const one = prepare(everything, "srgb");
    const two = prepare(part, "srgb");
    const packed = pack([{ ready: one }, { ready: two, layer: 3, invert: true }]);
    expect(packed.count).toBe(2);
    const first = packed.data[0]!;
    const second = packed.data[4]!;
    expect(first).toBe(2);
    // the first holds its 16 numbers, a curve of 1024 and a look of 729
    expect(second).toBe(2 + 16 + 1024 + 729);
    expect(packed.rows).toBe(Math.ceil((second + 16) / ROW));
    expect([...packed.data.subarray(first * 4, first * 4 + 4)]).toEqual([...one.gains, one.exposure]);
    expect(packed.data[(first + 2) * 4 + 3]).toBe(first + 16);
    expect(packed.data[(second + 10) * 4]).toBe(3);
    expect(packed.data[(second + 10) * 4 + 1]).toBe(1);
    expect(packed.data[(second + 2) * 4 + 3]).toBe(-1);
});

/** The flattening done here, as gl.test.ts does it, with the grade applied in the pass down before rounding, as the card does. */
function flattenHere(given: Uint8ClampedArray, width: number, shown: Look): Uint8ClampedArray {
    const pixels = given.slice();
    for (const cover of shown.covers) {
        const [red, green, blue] = [1, 3, 5].map((at) => parseInt(cover.color.slice(at, at + 2), 16));
        for (let y = cover.rect.y; y < cover.rect.y + cover.rect.height; y++) for (let x = cover.rect.x; x < cover.rect.x + cover.rect.width; x++) pixels.set([red!, green!, blue!, 255], (y * width + x) * 4);
    }
    const numbers = space("srgb");
    const layers = [prepare(everything, "srgb"), prepare(part, "srgb")];
    const mask = new Float32Array(MASK.width * MASK.height);
    for (let y = 0; y < MASK.height; y++) for (let x = 0; x < MASK.width; x++) mask[y * MASK.width + x] = maskValue(x, y);
    const read = maskReader(mask, MASK, original);
    const result = new Uint8ClampedArray(shown.width * shown.height * 4);
    const one = (pass: Pass, center: number, at: (t: number) => number[]) => {
        if (pass.filter === "nearest") return at(Math.min(pass.high, Math.max(pass.low, Math.floor(center + 0.501))));
        const sum = [0, 0, 0, 0];
        let total = 0;
        for (let t = Math.ceil(center - pass.support); t <= center + pass.support; t++) {
            const w = weight(pass.filter, (t - center) * pass.scale);
            const value = at(Math.min(pass.high, Math.max(pass.low, t)));
            for (let channel = 0; channel < 4; channel++) sum[channel]! += w * value[channel]!;
            total += w;
        }
        return sum.map((value) => value / total);
    };
    const stepX = shown.crop.width / shown.width;
    const stepY = shown.crop.height / shown.height;
    for (const piece of plan(shown, 64)) {
        const at = (x: number, y: number) => [...pixels.subarray(((piece.source.y + y) * width + piece.source.x + x) * 4, ((piece.source.y + y) * width + piece.source.x + x) * 4 + 4)];
        const across: number[][][] = [];
        for (let y = 0; y < piece.source.height; y++) {
            across.push([]);
            // a graded picture is held in half floats between the passes, not rounded to 8 bits
            for (let x = 0; x < piece.out.width; x++) across[y]!.push(one(piece.across, piece.across.start + x * piece.across.step, (t) => at(t, y)));
        }
        for (let y = 0; y < piece.out.height; y++)
            for (let x = 0; x < piece.out.width; x++) {
                const value = one(piece.down, piece.down.start + y * piece.down.step, (t) => across[t]![x]!);
                const place = { x: shown.crop.x + (piece.out.x + x + 0.5) * stepX, y: shown.crop.y + (piece.out.y + y + 0.5) * stepY };
                let color = value.slice(0, 3).map((each) => Math.min(1, Math.max(0, each / 255)));
                color = gradeOne(color, layers[0]!, numbers);
                const share = 1 - read(place.x, place.y);
                if (share > 0) {
                    const graded = gradeOne(color, layers[1]!, numbers);
                    color = share >= 1 ? graded : color.map((each, channel) => each + (graded[channel]! - each) * share);
                }
                result.set([...color.map((each) => Math.round(each * 255)), Math.round(Math.min(255, Math.max(0, value[3]!)))], ((piece.out.y + y) * shown.width + piece.out.x + x) * 4);
            }
    }
    return result;
}

const looks: Look[] = [
    look({ original, steps: [] }),
    look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 13, y: 7, width: 251, height: 170 } }, { id: "s2", type: "resize", width: 97, filter: "lanczos" }, { id: "s3", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 523, filter: "bilinear" }] }),
];

test("in Chromium, a picture graded by every control and a masked part flattens to the reference's pixels through WebGL2, and to WebGL2's through WebGPU, each to within one", async () => {
    const page = await corePage(
        `
        import { backendFor, loadPicture } from "${quire}/img/draw.ts";
        import { prepare, space } from "${quire}/img/grade.ts";
        import { pack } from "${quire}/img/grade-shader.ts";
        // a busy picture: every hue at every lightness, and a gray ramp
        const canvas = new OffscreenCanvas(300, 200);
        const context = canvas.getContext("2d");
        for (let x = 0; x < 300; x++) for (let y = 0; y < 200; y++) {
            context.fillStyle = y < 20 ? "rgb(" + Math.round(x * 255 / 299) + "," + Math.round(x * 255 / 299) + "," + Math.round(x * 255 / 299) + ")" : "hsl(" + (x * 1.2) + " " + (30 + (y % 70)) + "% " + (8 + (y * 0.42)) + "%)";
            context.fillRect(x, y, 1, 1);
        }
        const pixels = context.getImageData(0, 0, 300, 200).data;
        const blob = await canvas.convertToBlob({ type: "image/png" });
        window.pixels = [...pixels];
        window.made = async (only, looks, grades, mask) => {
            const backend = await backendFor(only === "WebGPU" ? new OffscreenCanvas(1, 1) : document.createElement("canvas"), only);
            if (!backend) return null;
            const picture = await loadPicture(backend, blob);
            const layer = new Float32Array(mask.width * mask.height);
            for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) layer[y * mask.width + x] = Math.max(0, Math.min(1, 1.5 - Math.hypot(x - 30, y - 20) / 10));
            const grading = { packed: pack([{ ready: prepare(grades[0], "srgb") }, { ready: prepare(grades[1], "srgb"), layer: 0, invert: true }]), numbers: space("srgb"), picture: { width: 300, height: 200 }, masks: { width: mask.width, height: mask.height, layers: [layer] } };
            const out = [];
            for (const each of looks) out.push([...(await picture.flatten(each, 64, grading)).data]);
            picture.destroy();
            backend.destroy();
            return out;
        };
    `,
        { args: ["--enable-unsafe-webgpu"] },
    );
    if (!page) return;
    try {
        const pixels = Uint8ClampedArray.from(await page.tab.run<number[]>("window.pixels"));
        const args = `${JSON.stringify(looks)}, ${JSON.stringify([everything, part])}, ${JSON.stringify(MASK)}`;
        const gl = await page.tab.run<number[][]>(`window.made("WebGL2", ${args})`);
        let changed = 0;
        looks.forEach((shown, index) => {
            const here = flattenHere(pixels, 300, shown);
            let most = 0;
            gl[index]!.forEach((value, at) => (most = Math.max(most, Math.abs(value - here[at]!))));
            expect(most).toBeLessThanOrEqual(1);
            if (index === 0) pixels.forEach((value, at) => (changed += value !== gl[0]![at] ? 1 : 0));
        });
        // the grade did change the picture, so the comparison is of something
        expect(changed).toBeGreaterThan(pixels.length / 2);
        const gpu = await page.tab.run<number[][] | null>(`window.made("WebGPU", ${args})`);
        if (!gpu) return console.log("this Chromium has no WebGPU, so its grading was not compared");
        looks.forEach((_, index) => {
            let most = 0;
            gpu[index]!.forEach((value, at) => (most = Math.max(most, Math.abs(value - gl[index]![at]!))));
            expect(most).toBeLessThanOrEqual(1);
        });
    } finally {
        await page.close();
    }
}, 120_000);

test("in Chromium on the graphics card, a grade's slider dragged on a 12 megapixel photograph redraws within a frame, and on 50 megapixels its time is printed", async () => {
    // WebGL2 on the machine's own card (headless Chromium otherwise draws with SwiftShader, on the processor)
    const page = await corePage(
        `
        import { backendFor, gradingFor, loadPicture } from "${quire}/img/draw.ts";
        import { look } from "${quire}/img/steps.ts";
        const frame = () => new Promise((done) => requestAnimationFrame(done));
        window.renderer = () => { const gl = document.createElement("canvas").getContext("webgl2"); const info = gl.getExtension("WEBGL_debug_renderer_info"); return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER); };
        window.slide = async (width, height, frames) => {
            const source = new OffscreenCanvas(width, height);
            const context = source.getContext("2d");
            const fade = context.createLinearGradient(0, 0, width, height);
            fade.addColorStop(0, "#203040");
            fade.addColorStop(1, "#e0a060");
            context.fillStyle = fade;
            context.fillRect(0, 0, width, height);
            for (let at = 0; at < 400; at++) { context.fillStyle = "hsl(" + ((at * 37) % 360) + " 60% 50%)"; context.fillRect((at * 7919) % width, (at * 104729) % height, 90, 60); }
            const blob = await source.convertToBlob({ type: "image/jpeg", quality: 0.9 });
            const canvas = document.createElement("canvas");
            canvas.width = 1300;
            canvas.height = 800;
            document.body.append(canvas);
            const backend = await backendFor(canvas, "WebGL2");
            const picture = await loadPicture(backend, blob);
            const original = { name: "pictures/p.jpg", width, height, type: "image/jpeg", bytes: blob.size };
            const scale = Math.min(1300 / width, 800 / height);
            const reader = new OffscreenCanvas(1, 1).getContext("2d");
            let best = Infinity;
            // three rounds, the quickest tenth of each kept and the best round's taken: other work on the machine makes frames slower, never quicker
            for (let round = 0; round < 3; round++) {
                await frame();
                const each = [];
                for (let at = 0; at < frames; at++) {
                    const before = performance.now();
                    // each frame a new grade, as a slider dragged makes: worked out, packed, sent, and the picture drawn graded by every kind of control
                    const shown = look({ original, steps: [{ id: "s1", type: "grade", grade: { light: at - 30, contrast: 20, shadows: 30, highs: -20, warmth: 10, color: 40, curves: { all: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }] }, wheels: { mids: { x: 0.2, y: 0.1 } }, colors: [{ hue: 200, shift: 20, saturation: 10, lightness: 0 }] } }] });
                    picture.draw({ look: shown, view: { scale, x: 0, y: 0 }, canvas, grading: gradingFor(shown, "srgb", { width, height }) });
                    reader.drawImage(canvas, 0, 0, 1, 1);
                    reader.getImageData(0, 0, 1, 1);
                    each.push(performance.now() - before);
                    await frame();
                }
                each.sort((a, b) => a - b);
                best = Math.min(best, each[Math.floor(frames / 10)]);
            }
            picture.destroy();
            backend.destroy();
            canvas.remove();
            return Math.round(best * 10) / 10;
        };
    `,
        { args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] },
    );
    if (!page) return;
    try {
        const renderer = await page.tab.run<string>("window.renderer()");
        const software = /SwiftShader|llvmpipe|software/i.test(renderer);
        for (const [width, height] of [[4000, 3000], [8660, 5773]] as const) {
            const ms = await page.tab.run<number>(`window.slide(${width}, ${height}, ${software ? 6 : 60})`);
            const megapixels = Math.round((width * height) / 1e6);
            console.log(`${megapixels} megapixels, a grade's slider dragged on ${renderer}: each frame graded, drawn and finished in ${ms} ms`);
            if (megapixels === 12 && !software) underLimit("a 12-megapixel frame graded on the card", ms, 16);
        }
        if (software) console.log("there is no graphics card here, so the frame's time was printed and not held");
    } finally {
        await page.close();
    }
}, 240_000);
