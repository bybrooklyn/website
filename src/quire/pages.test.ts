// What laying the text out in pages is held to: a piece that would cross the foot of a page starts
// the next one, the piece after a page break does too, a piece taller than a page is left where it
// falls, and the number of pages covers the text. The pages on screen are used in editor.test.ts.

import { expect, test } from "bun:test";
import { pageCount, paginate, type Piece } from "./pages";

// a page 1000 high with a gap of 20 under it and 100 kept clear above and below the text
const sheet = { height: 1000, gap: 20, margin: 100 };

/** Pieces of the given heights, one under another with a gap of 10, starting at the top margin. */
function stack(heights: number[], breaks: number[] = []): Piece[] {
    let at = 100;
    return heights.map((height, index) => {
        const piece = { top: at, bottom: at + height, breaks: breaks.includes(index) };
        at += height + 10;
        return piece;
    });
}

test("pieces that fit on the page stay where they are, and make one page", () => {
    expect(paginate(stack([100, 200, 300]), sheet)).toEqual({ pushes: [0, 0, 0], pages: 1 });
});

test("a piece that would cross the foot of a page starts the next page, below its top margin, and those after it follow", () => {
    // the third piece would end at 100 + 300 + 10 + 300 + 10 + 300 = 1020, past the foot at 900
    const { pushes, pages } = paginate(stack([300, 300, 300, 100]), sheet);
    // it moves from 720 to the next page's text, at 1020 + 100
    expect(pushes).toEqual([0, 0, 1120 - 720, 0]);
    expect(pages).toBe(2);
});

test("the piece after a page break starts the next page, and the break itself stays where it is", () => {
    const { pushes, pages } = paginate(stack([100, 20, 100], [1]), sheet);
    expect(pushes[1]).toBe(0);
    expect(100 + 110 + 30 + pushes[2]!).toBe(1120);
    expect(pages).toBe(2);
});

test("a piece taller than a page's text is left where it falls, and the next one goes on after it", () => {
    const { pushes } = paginate(stack([200, 900, 50]), sheet);
    expect(pushes[1]).toBe(0);
    // the tall piece ends at 310 + 900 = 1210, on the second page's text, so the next piece stays
    expect(pushes[2]).toBe(0);
});

test("a piece that would start in the gap between pages or in a page's top margin starts below that margin", () => {
    const { pushes } = paginate([{ top: 1010, bottom: 1050 }], sheet);
    expect(pushes).toEqual([110]);
    expect(paginate([{ top: 1050, bottom: 1080 }], sheet).pushes).toEqual([70]);
});

test("laying out again what is already laid out moves nothing more: the pushes come from where pieces were before any was moved", () => {
    const pieces = stack([300, 300, 300, 300, 300, 300, 300]);
    expect(paginate(pieces, sheet)).toEqual(paginate(pieces, sheet));
});

test("there are as many pages as it takes for the text and a margin under it", () => {
    expect(pageCount(0, sheet)).toBe(1);
    expect(pageCount(900, sheet)).toBe(1);
    expect(pageCount(901, sheet)).toBe(2);
    expect(pageCount(1020 + 900, sheet)).toBe(2);
});
