// What choosing a cover's color is held to: it takes the color round the place covered, not the
// color of what is covered; on a screenshot that is the page's color even with other words close
// by; at the picture's edge it uses what ring there is; and with no ring at all, what is inside.

import { expect, test } from "bun:test";
import { coverColor, hex, ringArea } from "./cover";

/** A picture of one color, with rectangles painted on it. */
function picture(width: number, height: number, ground: number[], painted: { x: number; y: number; width: number; height: number; color: number[] }[] = []) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const paint = painted.findLast((each) => x >= each.x && x < each.x + each.width && y >= each.y && y < each.y + each.height)?.color ?? ground;
            pixels.set([...paint, 255], (y * width + x) * 4);
        }
    return { pixels, area: { x: 0, y: 0, width, height } };
}

test("a word in black on a white page is covered in the page's white, not the word's black", () => {
    const { pixels, area } = picture(60, 30, [250, 250, 250], [{ x: 10, y: 10, width: 30, height: 8, color: [10, 10, 10] }]);
    expect(coverColor(pixels, area, { x: 10, y: 10, width: 30, height: 8 })).toBe("#fafafa");
});

test("other words close by, inside the ring, do not outvote the page", () => {
    const { pixels, area } = picture(80, 40, [30, 34, 40], [{ x: 10, y: 10, width: 30, height: 8, color: [230, 230, 230] }, { x: 41, y: 9, width: 2, height: 10, color: [230, 230, 230] }]);
    expect(coverColor(pixels, area, { x: 10, y: 10, width: 30, height: 8 })).toBe(hex(30, 34, 40));
});

test("a rectangle at the picture's edge uses the ring there is, and one that is the whole picture uses what is inside it", () => {
    const edge = picture(20, 20, [0, 128, 255], [{ x: 0, y: 0, width: 5, height: 5, color: [255, 0, 0] }]);
    expect(coverColor(edge.pixels, edge.area, { x: 0, y: 0, width: 5, height: 5 })).toBe("#0080ff");
    const whole = picture(4, 4, [9, 9, 9]);
    expect(coverColor(whole.pixels, whole.area, { x: 0, y: 0, width: 4, height: 4 })).toBe("#090909");
});

test("the part read is the rectangle with its ring, kept inside the picture", () => {
    expect(ringArea({ x: 1, y: 10, width: 5, height: 5 }, { width: 8, height: 100 })).toEqual({ x: 0, y: 7, width: 8, height: 11 });
});
