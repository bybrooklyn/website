// The arithmetic of what the pile of blocks lets a visitor choose. Run with `bun run test`.
import { expect, test } from "bun:test";
import { choices, deep, hueAt, kindFor, placeOf, tint, toRemove } from "./tints";

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

test("the wheel's hue is 0 at the top and grows clockwise, and a hue's place on it reads back as that hue", () => {
    expect(hueAt(50, 0, 50, 50)).toBe(0);
    expect(hueAt(100, 50, 50, 50)).toBe(90);
    expect(hueAt(50, 100, 50, 50)).toBe(180);
    expect(hueAt(0, 50, 50, 50)).toBe(270);
    for (const hue of [0, 37, 90, 181, 270, 359]) {
        const [x, y] = placeOf(hue);
        expect(hueAt(50 + x * 30, 50 + y * 30, 50, 50)).toBe(hue);
    }
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
