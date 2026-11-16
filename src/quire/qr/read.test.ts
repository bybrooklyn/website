// What the reader is held to, on codes drawn here by the maker and then spoiled in code as a camera would:
// turned to any angle, seen at an angle (one side up to 40 percent shorter than the other), blurred,
// light on dark, seen in a mirror, grainy, small in a large busy picture, and several in one picture; and
// what defeats it, written down as tests too, so a change that makes it read more or less is seen.

import { expect, test } from "bun:test";
import { encode, type Code } from "./encode";
import { mapFour, through, type Point } from "./perspective";
import { corner, finderRuns, grayOf, localBits, readCodes, wholeBits, type Picture } from "./read";
import type { Level } from "./tables";

/** How a code is laid in a scene: its four outer corners (the margin's) in pixels, the margin in modules, and whether it is drawn light on dark or mirrored. */
interface Placing {
    corners: Point[];
    margin?: number;
    light?: boolean;
    mirror?: boolean;
}

/** A scene of the given size: a soft, uneven ground (a gradient with some pattern), each code laid where it is told, then blurred and made grainy as asked. */
function scene(width: number, height: number, codes: { code: Code; place: Placing }[], options: { blur?: number; grain?: number; seed?: number } = {}): Picture {
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = 150 + 60 * Math.sin(x / 90) * Math.cos(y / 70) + 25 * Math.sin((x + y) / 13);
    for (const { code, place } of codes) {
        const margin = place.margin ?? 4;
        const full = code.side + margin * 2;
        const map = mapFour([{ x: 0, y: 0 }, { x: full, y: 0 }, { x: full, y: full }, { x: 0, y: full }], place.corners)!;
        const back = mapFour(place.corners, [{ x: 0, y: 0 }, { x: full, y: 0 }, { x: full, y: full }, { x: 0, y: full }])!;
        const xs = place.corners.map((each) => each.x);
        const ys = place.corners.map((each) => each.y);
        void map;
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
                // four samples a pixel, so edges are soft as a camera's are
                let sum = 0;
                let inside = 0;
                for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
                    const at = through(back, x + sx, y + sy);
                    if (at.x < 0 || at.y < 0 || at.x >= full || at.y >= full) continue;
                    inside++;
                    let mx = Math.floor(at.x) - margin;
                    let my = Math.floor(at.y) - margin;
                    if (place.mirror) [mx, my] = [my, mx];
                    const dark = mx >= 0 && my >= 0 && mx < code.side && my < code.side && code.modules[my * code.side + mx] === 1;
                    sum += dark !== !!place.light ? 25 : 235;
                }
                if (inside) gray[y * width + x] = (gray[y * width + x]! * (4 - inside) + sum) / 4;
            }
        }
    }
    let shades = gray;
    if (options.blur) {
        // three box blurs come close to a Gaussian of this spread
        const radius = Math.max(1, Math.round(options.blur));
        for (let pass = 0; pass < 3; pass++) {
            const next = new Float32Array(width * height);
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                let s = 0;
                let n = 0;
                for (let d = -radius; d <= radius; d++) if (x + d >= 0 && x + d < width) (s += shades[y * width + x + d]!), n++;
                next[y * width + x] = s / n;
            }
            const down = new Float32Array(width * height);
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                let s = 0;
                let n = 0;
                for (let d = -radius; d <= radius; d++) if (y + d >= 0 && y + d < height) (s += next[(y + d) * width + x]!), n++;
                down[y * width + x] = s / n;
            }
            shades = down;
        }
    }
    let seed = options.seed ?? 1;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const grain = options.grain ? (((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5) * 2 * options.grain : 0;
        const value = shades[i]! + grain;
        // a little color, as a photograph has: the reader works on lightness
        data.set([value * 1.02, value, value * 0.95, 255], i * 4);
    }
    return { data, width, height };
}

/** A square's corners turned by an angle about a middle. */
const turned = (cx: number, cy: number, size: number, degrees: number): Point[] => {
    const r = (degrees * Math.PI) / 180;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: cx + (size / 2) * (dx! * Math.cos(r) - dy! * Math.sin(r)), y: cy + (size / 2) * (dx! * Math.sin(r) + dy! * Math.cos(r)) }));
};

const texts = (version: number) => `qr ${"v".repeat(version * 5)}`;
const made = (text: string, level: Level = "M", minVersion = 1) => encode(text, { level, raise: false, minVersion });

test("the finder's runs are told by their proportions, and three finders are put in order as a corner", () => {
    expect(finderRuns([4, 4, 12, 4, 4])).toBe(true);
    expect(finderRuns([4, 4, 4, 4, 4])).toBe(false);
    const a = { x: 0, y: 0, size: 4, count: 3 };
    const b = { x: 100, y: 0, size: 4, count: 3 };
    const c = { x: 0, y: 100, size: 4, count: 3 };
    expect(corner(b, c, a)).toEqual([a, b, c]);
    expect(corner(a, c, b)).toEqual([a, b, c]);
    expect(corner(a, b, { x: 300, y: 300, size: 4, count: 3 })).toBeUndefined();
});

test("a plain screenshot of codes of every size is read, from version 1 to 40", () => {
    for (const version of [1, 2, 4, 6, 7, 10, 14, 20, 27, 33, 40]) {
        const text = version === 40 ? "a".repeat(2900) : texts(version);
        const code = made(text, version === 40 ? "L" : "M", version);
        expect(code.version).toBe(version);
        const scale = version >= 27 ? 3 : 4;
        const size = (code.side + 8) * scale;
        const found = readCodes(scene(size + 40, size + 40, [{ code, place: { corners: [{ x: 20, y: 20 }, { x: 20 + size, y: 20 }, { x: 20 + size, y: 20 + size }, { x: 20, y: 20 + size }] } }]));
        expect(found.map((each) => each.text)).toEqual([text]);
    }
}, 60_000);

test("a code turned to any angle is read", () => {
    const code = made("turned around", "M");
    for (const degrees of [0, 15, 30, 45, 60, 90, 135, 180, 250, 333]) {
        const found = readCodes(scene(420, 420, [{ code, place: { corners: turned(210, 210, 260, degrees) } }]));
        expect([degrees, found[0]?.text]).toEqual([degrees, "turned around"]);
    }
}, 60_000);

test("a code seen at an angle is read, one side up to 40 percent shorter than the other, at version 1, 5 and 12", () => {
    for (const version of [1, 5, 12]) {
        const code = made(texts(version), "L", version);
        expect(code.version).toBe(version);
        for (const squeeze of [0.15, 0.3, 0.4]) {
            const size = Math.max(300, (code.side + 8) * 4);
            const w = size + 100;
            // the far side shorter, as a code tilted away from the camera is seen
            const corners = [{ x: 50 + (size * squeeze) / 2, y: 50 }, { x: 50 + size - (size * squeeze) / 2, y: 50 }, { x: 50 + size, y: 50 + size * 0.9 }, { x: 50, y: 50 + size * 0.9 }];
            const found = readCodes(scene(w, w, [{ code, place: { corners } }]));
            expect([version, squeeze, found[0]?.text]).toEqual([version, squeeze, texts(version)]);
        }
    }
}, 60_000);

test("a blurred code is read, the blur up to about a third of a module", () => {
    const code = made(texts(4), "M");
    for (const blur of [1, 2, 3]) {
        // 9 pixels a module
        const size = (code.side + 8) * 9;
        const found = readCodes(scene(size + 60, size + 60, [{ code, place: { corners: turned(size / 2 + 30, size / 2 + 30, size, 8) } }], { blur }));
        expect([blur, found[0]?.text]).toEqual([blur, texts(4)]);
    }
}, 60_000);

test("light on dark, in a mirror and grainy, each is read", () => {
    const code = made("light on dark ✓", "Q");
    const place = { corners: turned(200, 200, 280, 20) };
    expect(readCodes(scene(400, 400, [{ code, place: { ...place, light: true } }])).map((each) => [each.text, each.light])).toEqual([["light on dark ✓", true]]);
    expect(readCodes(scene(400, 400, [{ code, place: { ...place, mirror: true } }]))[0]?.text).toBe("light on dark ✓");
    expect(readCodes(scene(400, 400, [{ code, place }], { grain: 60, seed: 9 }))[0]?.text).toBe("light on dark ✓");
}, 60_000);

test("a small code in a large busy photograph is found, and several codes in one picture are each read once", () => {
    const small = made("small in a big picture", "M");
    const big = readCodes(scene(2400, 1800, [{ code: small, place: { corners: turned(1700, 1200, 170, -12) } }], { blur: 1 }));
    expect(big.map((each) => each.text)).toEqual(["small in a big picture"]);
    const several = ["first", "second code", "THIRD 333", "the fourth one ✓"].map((text) => made(text, "M"));
    const places = [turned(150, 150, 220, 5), turned(470, 160, 230, -20), turned(160, 470, 200, 40), turned(480, 480, 240, 90)];
    const found = readCodes(scene(640, 640, several.map((code, i) => ({ code, place: { corners: places[i]! } }))));
    expect(found.map((each) => each.text).sort()).toEqual(["THIRD 333", "first", "second code", "the fourth one ✓"]);
}, 60_000);

test("the corners found are where the code was laid", () => {
    const code = made("corners", "M");
    const size = (code.side + 8) * 6;
    const found = readCodes(scene(size + 40, size + 40, [{ code, place: { corners: [{ x: 20, y: 20 }, { x: 20 + size, y: 20 }, { x: 20 + size, y: 20 + size }, { x: 20, y: 20 + size }] } }]));
    // the code's own corners, inside the margin of 4 modules of 6 pixels
    expect(found[0]!.corners.map((each) => [Math.round(each.x / 6), Math.round(each.y / 6)])).toEqual([[Math.round(44 / 6), Math.round(44 / 6)], [Math.round((44 + code.side * 6) / 6), Math.round(44 / 6)], [Math.round((44 + code.side * 6) / 6), Math.round((44 + code.side * 6) / 6)], [Math.round(44 / 6), Math.round((44 + code.side * 6) / 6)]]);
});

test("what defeats it: modules under two pixels, a blur of more than half a module, no quiet margin", () => {
    const code = made(texts(6), "M");
    const tiny = (code.side + 8) * 1.5;
    expect(readCodes(scene(200, 200, [{ code, place: { corners: turned(100, 100, tiny, 0) } }]))).toEqual([]);
    const size = (code.side + 8) * 6;
    expect(readCodes(scene(size + 40, size + 40, [{ code, place: { corners: turned(size / 2 + 20, size / 2 + 20, size, 0) } }], { blur: 4 }))).toEqual([]);
    // dark ground right up to the finders: the finder's outer light run is gone
    const crowded = scene(size, size, [{ code, place: { corners: turned(size / 2, size / 2, (code.side * size) / (code.side + 8), 0), margin: 0 } }]);
    for (let i = 0; i < crowded.data.length; i += 4) if (crowded.data[i]! > 140 && crowded.data[i]! < 230) crowded.data.fill(20, i, i + 3);
    expect(readCodes(crowded)).toEqual([]);
}, 60_000);

test("the gray picture counts what is clear as white, and each pixel is called against its surroundings", () => {
    const clear = { data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), width: 2, height: 1 };
    expect([...grayOf(clear).data]).toEqual([255, 0]);
    // a dark square on a ground that runs from dark to light: called dark everywhere it is, whatever the ground
    const width = 160;
    const data = new Uint8Array(width * width);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) data[y * width + x] = x > 60 && x < 100 && y > 60 && y < 100 ? 10 + x / 4 : 60 + x;
    const local = localBits({ data, width, height: width });
    expect(local.data[80 * width + 70]).toBe(1);
    expect(local.data[80 * width + 140]).toBe(0);
    expect(wholeBits({ data, width, height: width }).data[80 * width + 80]).toBe(1);
});
