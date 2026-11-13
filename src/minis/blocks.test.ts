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
