// What drawing through WebGL2 is held to: flattening gives the same pixels as the same arithmetic
// done here on the processor (the same plan, the same filters, rounding between the passes as the
// card's 8-bit textures do), to within rounding, through crops, every filter, sizes up and down and
// turns, piece by piece; and a covered place holds none of the original's pixels, through any resize
// or turn, a cover made on the turned picture too.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { plan, weight, type Pass } from "./draw";
import { look, type Look } from "./steps";
import { cornersOf, turnOf } from "./turn";

const original = { name: "pictures/a.png", width: 300, height: 200, type: "image/png", bytes: 1 };

/**
 * The flattening done on the processor with the same plan and the same arithmetic as the shaders,
 * rounding between the passes as the card's 8-bit textures do. With `doubt`, it flattens instead a
 * picture that is white only where a pixel's middle lies within a tenth of a pixel of a turned cover's
 * edge, which a card's rasterizer (snapping corners to a sixteenth of a pixel or finer) may paint or
 * not; where that comes out anything but black, the two may differ.
 */
function flattenHere(pixels: Uint8ClampedArray, width: number, shown: Look, most: number, doubt = false): Uint8ClampedArray {
    const covered = doubt ? new Uint8ClampedArray(pixels.length) : pixels.slice();
    const height = pixels.length / 4 / width;
    for (const cover of shown.covers) {
        if (doubt) {
            if (!cover.angle) continue;
            const grow = Math.SQRT1_2;
            const corners = cornersOf({ x: cover.rect.x - grow, y: cover.rect.y - grow, width: cover.rect.width + 2 * grow, height: cover.rect.height + 2 * grow }, cover.angle);
            const near = (x: number, y: number) => corners.some((a, at) => {
                const b = corners[(at + 1) % 4]!;
                const length = Math.hypot(b.x - a.x, b.y - a.y);
                const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (length * length);
                return t >= -0.01 && t <= 1.01 && Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / length < 0.1;
            });
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (near(x + 0.5, y + 0.5)) covered.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
            continue;
        }
        const [red, green, blue] = [1, 3, 5].map((at) => parseInt(cover.color.slice(at, at + 2), 16));
        if (!cover.angle) {
            for (let y = cover.rect.y; y < cover.rect.y + cover.rect.height; y++) for (let x = cover.rect.x; x < cover.rect.x + cover.rect.width; x++) covered.set([red!, green!, blue!, 255], (y * width + x) * 4);
            continue;
        }
        // a cover turned on its own: every pixel whose middle is inside it grown by half a pixel's diagonal, as the card rasterizes it
        const grow = Math.SQRT1_2;
        const corners = cornersOf({ x: cover.rect.x - grow, y: cover.rect.y - grow, width: cover.rect.width + 2 * grow, height: cover.rect.height + 2 * grow }, cover.angle);
        const inside = (x: number, y: number) => corners.every((a, at) => {
            const b = corners[(at + 1) % 4]!;
            return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
        });
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x + 0.5, y + 0.5)) covered.set([red!, green!, blue!, 255], (y * width + x) * 4);
    }
    const turn = turnOf(shown.turn ?? 0, { width, height });
    // doubting, every reach counts as a share, the negative lobes too, so that nothing a doubted pixel touches is missed
    const lanczos = (x: number) => (doubt ? Math.abs(weight("lanczos", x)) : weight("lanczos", x));
    const result = new Uint8ClampedArray(shown.width * shown.height * 4);
    const one = (pass: Pass, center: number, read: (at: number) => number[]) => {
        if (pass.filter === "nearest") return read(Math.min(pass.high, Math.max(pass.low, Math.floor(center + 0.501))));
        const sum = [0, 0, 0, 0];
        let total = 0;
        for (let t = Math.ceil(center - pass.support); t <= center + pass.support; t++) {
            const w = doubt ? Math.abs(weight(pass.filter, (t - center) * pass.scale)) : weight(pass.filter, (t - center) * pass.scale);
            const value = read(Math.min(pass.high, Math.max(pass.low, t)));
            for (let channel = 0; channel < 4; channel++) sum[channel]! += w * value[channel]!;
            total += w;
        }
        return sum.map((value) => Math.round(Math.min(255, Math.max(0, value / total))));
    };
    const wider = turn.degrees ? Math.abs(turn.cos) + Math.abs(turn.sin) : 1;
    for (const piece of plan(shown, turn.degrees ? Math.max(16, Math.floor((most - 10) / wider)) : most)) {
        let at = (x: number, y: number) => [...covered.subarray(((piece.source.y + y) * width + piece.source.x + x) * 4, ((piece.source.y + y) * width + piece.source.x + x) * 4 + 4)];
        if (turn.degrees) {
            // the piece made upright first: each level pixel read from the original about its place there, six by six, rounded to 8 bits
            const level: number[][] = [];
            const read = (x: number, y: number) => covered.subarray((Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4);
            for (let y = 0; y < piece.source.height; y++)
                for (let x = 0; x < piece.source.width; x++) {
                    const qx = piece.source.x - width / 2 + x + 0.5;
                    const qy = piece.source.y - height / 2 + y + 0.5;
                    const ux = turn.cos * qx + turn.sin * qy + width / 2 - 0.5;
                    const uy = -turn.sin * qx + turn.cos * qy + height / 2 - 0.5;
                    const fx = Math.floor(ux) - 2;
                    const fy = Math.floor(uy) - 2;
                    const sum = [0, 0, 0, 0];
                    let total = 0;
                    for (let j = 0; j < 6; j++)
                        for (let i = 0; i < 6; i++) {
                            const w = lanczos(fx + i - ux) * lanczos(fy + j - uy);
                            const value = read(fx + i, fy + j);
                            for (let channel = 0; channel < 4; channel++) sum[channel]! += w * value[channel]!;
                            total += w;
                        }
                    level.push(sum.map((value) => Math.round(Math.min(255, Math.max(0, value / total)))));
                }
            at = (x: number, y: number) => level[y * piece.source.width + x]!;
        }
        const across: number[][][] = [];
        for (let y = 0; y < piece.source.height; y++) {
            across.push([]);
            for (let x = 0; x < piece.out.width; x++) across[y]!.push(one(piece.across, piece.across.start + x * piece.across.step, (t) => at(t, y)));
        }
        for (let y = 0; y < piece.out.height; y++) for (let x = 0; x < piece.out.width; x++) result.set(one(piece.down, piece.down.start + y * piece.down.step, (t) => across[t]![x]!), ((piece.out.y + y) * shown.width + piece.out.x + x) * 4);
    }
    return result;
}

const looks: Look[] = [
    look({ original, steps: [{ id: "s1", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 13, y: 7, width: 251, height: 170 } }, { id: "s2", type: "resize", width: 97, filter: "lanczos" }, { id: "s3", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 523, filter: "bilinear" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 140, height: 33, filter: "nearest" }] }),
    // turned: level with no crop of her own; turned the other way with a crop, a shrink, a cover made before turning and one made on the turned picture; turned a little and made larger
    look({ original, steps: [{ id: "s1", type: "turn", angle: 7 }] }),
    look({ original, steps: [{ id: "s1", type: "turn", angle: -11 }, { id: "s2", type: "crop", rect: { x: 40, y: 30, width: 200, height: 140 } }, { id: "s3", type: "resize", width: 97, filter: "lanczos" }, { id: "s4", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }, { id: "s5", type: "cover", rect: { x: 120, y: 90, width: 50, height: 24 }, color: "#2040e0", angle: 11 }] }),
    look({ original, steps: [{ id: "s1", type: "turn", angle: 3.5 }, { id: "s2", type: "resize", width: 410, filter: "bilinear" }] }),
];

test("in Chromium, WebGL2 flattens to the same pixels as the same arithmetic here, to within rounding, and covered places hold none of the original", async () => {
    const page = await corePage(`
        import { backendFor, loadPicture } from "${quire}/img/draw.ts";
        // a busy picture: stripes and a gradient, and a block of magenta that the covers sit on
        const canvas = new OffscreenCanvas(300, 200);
        const context = canvas.getContext("2d");
        for (let x = 0; x < 300; x++) for (let y = 0; y < 200; y += 50) { context.fillStyle = "rgb(" + ((x * 7) % 256) + "," + ((y * 3 + x) % 256) + "," + (x % 2 ? 250 : 20) + ")"; context.fillRect(x, y, 1, 50); }
        context.fillStyle = "#ff00ff";
        context.fillRect(45, 45, 50, 20);
        // and a block of a near magenta under the cover made on the turned picture
        context.fillStyle = "rgb(200, 0, 200)";
        context.fillRect(130, 95, 30, 14);
        const pixels = context.getImageData(0, 0, 300, 200).data;
        const blob = await canvas.convertToBlob({ type: "image/png" });
        window.made = async (only, looks) => {
            const backend = await backendFor(document.createElement("canvas"), only);
            if (!backend) return undefined;
            const picture = await loadPicture(backend, blob);
            const out = [];
            for (const each of looks) out.push([...(await picture.flatten(each, 64)).data]);
            picture.destroy();
            return { name: backend.name, out };
        };
        window.pixels = [...pixels];
    `);
    if (!page) return;
    try {
        const pixels = Uint8ClampedArray.from(await page.tab.run<number[]>("window.pixels"));
        const gl = await page.tab.run<{ name: string; out: number[][] }>(`window.made("WebGL2", ${JSON.stringify(looks)})`);
        expect(gl.name).toBe("WebGL2");
        looks.forEach((shown, index) => {
            const here = flattenHere(pixels, 300, shown, 64);
            // where a turned cover's edge passes within a tenth of a pixel's middle, the card may paint that pixel or not
            const doubt = flattenHere(pixels, 300, shown, 64, true);
            let most = 0;
            let doubted = 0;
            gl.out[index]!.forEach((value, at) => {
                if (doubt[at - (at % 4)]) return void (at % 4 === 0 && doubted++);
                most = Math.max(most, Math.abs(value - here[at]!));
            });
            expect(most).toBeLessThanOrEqual(1);
            if (doubted) console.log(`${doubted} of ${shown.width * shown.height} pixels near a turned cover's edge were not compared`);
            // nothing of the magenta under a cover is left, through any resize
            if (shown.covers.length) for (let at = 0; at < gl.out[index]!.length; at += 4) expect(gl.out[index]![at] === 255 && gl.out[index]![at + 1]! < 40 && gl.out[index]![at + 2] === 255).toBe(false);
            if (shown.covers.some((cover) => cover.angle)) for (let at = 0; at < gl.out[index]!.length; at += 4) expect(gl.out[index]![at]! > 170 && gl.out[index]![at + 1]! < 30 && gl.out[index]![at + 2]! > 170 && Math.abs(gl.out[index]![at]! - gl.out[index]![at + 2]!) < 20).toBe(false);
            if (shown.turn) console.log(`turned ${shown.turn} degrees: WebGL2 against the arithmetic here, at most ${most} apart`);
        });
    } finally {
        await page.close();
    }
}, 60_000);

