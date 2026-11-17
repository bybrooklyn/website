// What the pile of blocks is held to when its box changes size. Run with `bun run test`.
import { expect, test } from "bun:test";
import type { Mote } from "../mote";
import blocks from "./blocks";

/** A stage with no page: a drawing surface that only notes where every outline goes. */
function stage(width: number, height: number) {
    const points: [number, number][] = [];
    const ctx = new Proxy({}, {
        get: (_, name) => (name === "moveTo" || name === "lineTo" || name === "arc" ? (x: number, y: number) => points.push([x, y]) : () => {}),
        set: () => true,
    }) as CanvasRenderingContext2D;
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ borderTopLeftRadius: "0px" });
    const woken = { count: 0 };
    const m = { width, height, time: 0, preview: false, canvas: { parentElement: null }, ctx, pointer: { x: 0, y: 0, down: false, inside: false }, color: () => "#000", wake: () => woken.count++ } as unknown as Mote;
    return { m, points, woken };
}

/** Runs something with chance that is the same every time: which pieces fall, and how they spin, are by chance, and a pile held to a test must be the same pile each run. */
function withChance<T>(seed: number, run: () => T): T {
    const real = Math.random;
    Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    try {
        return run();
    } finally {
        Math.random = real;
    }
}

// Six piles. The last four are ones that never came to rest while a body slept by its speed alone: squeezed together, they
// trembled by less than a pixel for ever, and the stage went on stepping and drawing a pile that looked still.
for (const seed of [1, 2, 3, 5, 7, 10]) {
    test(`narrowing the box brings every block inside the new walls, starts the stage, and the pile comes to rest (pile ${seed})`, () => {
        withChance(seed, () => {
            const { m, points, woken } = stage(800, 400);
            const scene = blocks(m);
            for (let i = 0; i < 12; i++) scene.double!(40 + i * 64, 60);
            for (let i = 0; i < 900; i++) scene.step!(1 / 120);
            // a phone turned from landscape to portrait: the box is far narrower, and the stage is started for the pile to fall into place with no pointer over it
            m.width = 300;
            const before = woken.count;
            scene.resize!();
            expect(woken.count).toBeGreaterThan(before);
            let rested = false;
            for (let i = 0; i < 120 * 30 && !rested; i++) {
                scene.step!(1 / 120);
                rested = scene.resting!();
            }
            expect(rested).toBe(true);
            points.length = 0;
            scene.draw();
            expect(points.length).toBeGreaterThan(0);
            for (const [x, y] of points) {
                expect(x).toBeGreaterThan(-2);
                expect(x).toBeLessThan(302);
                expect(y).toBeGreaterThan(-2);
                expect(y).toBeLessThan(402);
            }
        });
    });
}

test("a remove takes the newest piece when none is held or pointed at, the one under the pointer when one is, and nothing from an empty pile", () => {
    const { m } = stage(800, 400);
    const scene = blocks(m);
    const start = scene.pieces().length;
    scene.double!(700, 60);
    expect(scene.pieces().length).toBe(start + 1);
    // nothing held, the pointer elsewhere: the newest goes
    expect(scene.remove()).toBe(true);
    expect(scene.pieces().length).toBe(start);
    // the pointer over the middle block of the bottom row: that one goes, and the pile above it falls and comes to rest
    m.pointer.inside = true;
    m.pointer.x = 400;
    m.pointer.y = 400 - 6 - 20;
    expect(scene.remove()).toBe(true);
    expect(scene.pieces().length).toBe(start - 1);
    m.pointer.inside = false;
    let rested = false;
    for (let i = 0; i < 120 * 30 && !rested; i++) {
        scene.step!(1 / 120);
        rested = scene.resting!();
    }
    expect(rested).toBe(true);
    // every piece taken, one press at a time; then there is nothing to take
    while (scene.pieces().length) expect(scene.remove()).toBe(true);
    expect(scene.remove()).toBe(false);
});

test("the kind and the color chosen are what the next piece is, and a hue by chance keeps the darkness chosen", () => {
    const { m } = stage(800, 400);
    const scene = blocks(m);
    // the pile it opens on is the soft one it has always been
    expect(scene.pieces().every((piece) => piece.kind === "block" && piece.color.startsWith("oklch(0.860 0.085 "))).toBe(true);
    scene.choose({ kind: "ball", hue: 200, dark: 0.5 });
    scene.double!(100, 60);
    expect(scene.pieces().at(-1)).toEqual({ kind: "ball", color: "oklch(0.610 0.100 200)" });
    scene.choose({ kind: "wedge", hue: undefined });
    scene.double!(300, 60);
    const last = scene.pieces().at(-1)!;
    expect(last.kind).toBe("wedge");
    expect(last.color.startsWith("oklch(0.610 0.100 ")).toBe(true);
});

test("Z takes back the pieces dropped, newest first, and never the pile it opened on; clear empties the box", () => {
    const { m } = stage(800, 400);
    const scene = blocks(m);
    const start = scene.pieces().length;
    // nothing dropped yet: the pile it opened on is not taken back
    expect(scene.undo()).toBe(false);
    expect(scene.pieces().length).toBe(start);
    for (const x of [100, 300, 700]) scene.double!(x, 60);
    expect(scene.pieces().length).toBe(start + 3);
    expect(scene.undo()).toBe(true);
    expect(scene.pieces().length).toBe(start + 2);
    // one taken away with Backspace (the newest, with the pointer elsewhere) is not taken back a second time
    expect(scene.remove()).toBe(true);
    expect(scene.undo()).toBe(true);
    expect(scene.pieces().length).toBe(start);
    expect(scene.undo()).toBe(false);
    // clear takes everything, the opening pile too, and leaves nothing to take back; the box takes pieces again
    scene.double!(100, 60);
    scene.clear();
    expect(scene.pieces().length).toBe(0);
    expect(scene.undo()).toBe(false);
    scene.double!(100, 60);
    expect(scene.pieces().length).toBe(1);
    expect(scene.undo()).toBe(true);
    expect(scene.pieces().length).toBe(0);
});
