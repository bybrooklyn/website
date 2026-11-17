// The arithmetic of what the pile of blocks lets a visitor choose. Run with `bun run test`.
import { expect, test } from "bun:test";
import { choices, deep, grey, HANDLE, HUES, hues, KINDS, kindFor, ramp, tint, tones, toRemove } from "./tints";

test("a kind chosen is the kind dropped, and any is mostly blocks with a ball or a wedge now and then", () => {
    expect(kindFor("ball", 0.1)).toBe("ball");
    expect(kindFor("wedge", 0.99)).toBe("wedge");
    expect(kindFor("block", 0.9)).toBe("block");
    expect([0, 0.69, 0.7, 0.84, 0.85, 0.99].map((chance) => kindFor("any", chance))).toEqual(["block", "block", "ball", "ball", "wedge", "wedge"]);
});

test("at no darkness a piece is the soft color the pile has always had, and darker it keeps its hue", () => {
    expect(tint(200)).toBe("oklch(0.860 0.085 200)");
    expect(tint(200, 0)).toBe("oklch(0.860 0.085 200)");
    expect(tint(200, 1)).toBe("oklch(0.360 0.115 200)");
    expect(tint(200, 0.5)).toBe("oklch(0.610 0.100 200)");
    // a hue past a whole turn, or below nothing, comes round; a darkness out of range is held in it
    expect(tint(560)).toBe(tint(200));
    expect(tint(-160)).toBe(tint(200));
    expect(tint(359.6)).toBe("oklch(0.860 0.085 0)");
    expect(tint(10, 7)).toBe(tint(10, 1));
    expect(tint(10, Number.NaN)).toBe(tint(10, 0));
    expect(deep(0)).toBe(false);
    expect(deep(0.8)).toBe(true);
});

test("the bar of hues runs through every hue at the darkness chosen, and the bar of darkness through one hue from light to dark", () => {
    const row = hues(0.5);
    expect(row.length).toBe(13);
    expect(row[0]).toBe(tint(0, 0.5));
    expect(row[6]).toBe(tint(HUES / 2, 0.5));
    expect(row[12]).toBe(tint(HUES, 0.5));
    expect(tones(200)).toEqual([tint(200, 0), tint(200, 0.25), tint(200, 0.5), tint(200, 0.75), tint(200, 1)]);
    // with a hue by chance for every piece the bar of darkness is the greys, as light and as dark as a piece would be
    expect(tones(undefined)).toEqual([0, 0.25, 0.5, 0.75, 1].map(grey));
    expect(grey(0)).toBe("oklch(0.860 0.020 300)");
    expect(grey(1)).toBe("oklch(0.360 0.020 300)");
});

test("a bar's colors lie between the two places its handle's middle can reach, so the color under the handle is the one picked", () => {
    const picture = ramp(["red", "lime", "blue"]);
    expect(picture).toBe(`linear-gradient(to right, red calc(${HANDLE}rem + (100% - ${HANDLE * 2}rem) * 0.0000), lime calc(${HANDLE}rem + (100% - ${HANDLE * 2}rem) * 0.5000), blue calc(${HANDLE}rem + (100% - ${HANDLE * 2}rem) * 1.0000))`);
    // the kinds are named on the page by their own words
    expect(KINDS).toEqual(["any", "block", "ball", "wedge"]);
});

test("a remove takes the piece held, else the one under the pointer, else the newest, and nothing from an empty pile", () => {
    const pile = ["a", "b", "c"];
    expect(toRemove(pile, "a", "b")).toBe("a");
    expect(toRemove(pile, undefined, "b")).toBe("b");
    expect(toRemove(pile)).toBe("c");
    // something held or pointed at that is not in the pile is not taken for one that is
    expect(toRemove(pile, "z")).toBe("c");
    expect(toRemove([])).toBeUndefined();
});

test("what was kept between visits is read back taking nothing on trust", () => {
    expect(choices(undefined)).toEqual({ kind: "any", hue: undefined, dark: 0 });
    expect(choices({ kind: "ball", hue: 400, dark: 0.3 })).toEqual({ kind: "ball", hue: 40, dark: 0.3 });
    expect(choices({ kind: "cube", hue: "red", dark: 9 })).toEqual({ kind: "any", hue: undefined, dark: 1 });
    expect(choices("nonsense")).toEqual({ kind: "any", hue: undefined, dark: 0 });
});
