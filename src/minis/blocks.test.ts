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
    const m = { width, height, time: 0, preview: false, canvas: { parentElement: null }, ctx, pointer: { x: 0, y: 0, down: false, inside: false }, color: () => "#000" } as unknown as Mote;
    return { m, points };
}

test("narrowing the box brings every block inside the new walls, and the pile comes to rest", () => {
    const { m, points } = stage(800, 400);
    const scene = blocks(m);
    for (let i = 0; i < 12; i++) scene.double!(40 + i * 64, 60);
    for (let i = 0; i < 900; i++) scene.step!(1 / 120);
    // a phone turned from landscape to portrait: the box is far narrower
    m.width = 300;
    scene.resize!();
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
