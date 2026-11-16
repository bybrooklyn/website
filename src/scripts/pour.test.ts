// The pour's arithmetic: a picture's blobs follow from its address and are the same every time; they
// are spread over the frame; before a blob starts it has no outline; and at the end every blob's
// outline lies wholly outside the frame, so the last frame shows the whole picture and nothing else.

import { expect, test } from "bun:test";
import { blobsFor, outline, seedOf } from "./pour";

test("the same address gives the same blobs, and another address gives others", () => {
    const first = blobsFor(seedOf("/photos/a.avif"), 5);
    expect(blobsFor(seedOf("/photos/a.avif"), 5)).toEqual(first);
    expect(blobsFor(seedOf("/photos/b.avif"), 5)).not.toEqual(first);
    expect(first.length).toBe(5);
});

test("the blobs are inside the frame, no two from the same part of it, and none starts later than a quarter of the way through", () => {
    for (const address of ["/a", "/b", "/photos/img-0406-copy.avif", "x"]) {
        const blobs = blobsFor(seedOf(address), 5);
        for (const blob of blobs) {
            expect(blob.x).toBeGreaterThan(0);
            expect(blob.x).toBeLessThan(1);
            expect(blob.y).toBeGreaterThan(0);
            expect(blob.y).toBeLessThan(1);
            expect(blob.starts).toBeLessThan(0.25);
        }
        const cells = new Set(blobs.map((blob) => `${Math.floor(blob.x * 3)},${Math.floor(blob.y * 2)}`));
        expect(cells.size).toBe(5);
    }
});

test("a blob has no outline before it starts, and at the end its outline is outside the whole frame", () => {
    const [width, height] = [640, 400];
    for (const blob of blobsFor(seedOf("/photos/a.avif"), 5)) {
        expect(outline(blob, 0, width, height)).toBe("");
        const points = [...outline(blob, 1, width, height).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((found) => [Number(found[1]), Number(found[2])] as const);
        expect(points.length).toBe(40);
        const cx = blob.x * width;
        const cy = blob.y * height;
        const farthest = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
        // forty straight sides round a circle come within a third of a hundredth of its radius of the middle
        for (const [x, y] of points) expect(Math.hypot(x - cx, y - cy) * Math.cos(Math.PI / 40)).toBeGreaterThan(farthest);
    }
});
