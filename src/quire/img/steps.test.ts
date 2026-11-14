// What the picture document is held to: the steps apply in order to give the picture as it looks,
// in the original's pixels, so a cover or a mark stays put when an earlier crop changes; steps are
// changed, taken away, moved and switched off without touching the list given; undo and redo walk
// the changes; steps.json reads back what was written, and a damaged or hostile file gives what can
// be read of it, quickly, and never throws.

import { expect, test } from "bun:test";
import { add, change, createHistory, edited, fresh, LIMITS, look, move, readSteps, remove, setOnly, toggle, within, writeSteps, type Kept } from "./steps";

const original = { name: "pictures/cat.png", width: 1200, height: 800, type: "image/png", bytes: 52_000 };

test("with no steps the picture looks as the original does, whole and at its own size", () => {
    expect(look(fresh(original))).toEqual({ crop: { x: 0, y: 0, width: 1200, height: 800 }, width: 1200, height: 800, filter: "lanczos", covers: [], marks: [] });
    expect(edited(fresh(original))).toBe(false);
});

test("a crop keeps a part of the original, inside it, in whole pixels, whichever way it was dragged", () => {
    const steps = add([], { type: "crop", rect: { x: 300.4, y: 500, width: -200, height: 900 } });
    expect(look({ original, steps }).crop).toEqual({ x: 100, y: 500, width: 200, height: 300 });
    expect(within({ x: 5000, y: 5000, width: 10, height: 10 }, original)).toEqual({ x: 1199, y: 799, width: 1, height: 1 });
});

test("a resize keeps the crop's shape unless a height is given, and keeps its width when the crop under it changes", () => {
    let steps = add([], { type: "crop", rect: { x: 0, y: 0, width: 600, height: 400 } });
    steps = add(steps, { type: "resize", width: 300, filter: "lanczos" });
    expect(look({ original, steps })).toMatchObject({ width: 300, height: 200 });
    steps = change(steps, steps[0]!.id, { rect: { x: 0, y: 0, width: 1000, height: 500 } });
    expect(look({ original, steps })).toMatchObject({ width: 300, height: 150 });
    steps = change(steps, steps[1]!.id, { height: 100 });
    expect(look({ original, steps })).toMatchObject({ width: 300, height: 100 });
});

test("covers and marks are kept in the original's pixels, so a later change to the crop leaves them where they were put", () => {
    let steps = add([], { type: "cover", rect: { x: 10, y: 20, width: 30, height: 40 }, color: "#ffffff" });
    steps = add(steps, { type: "arrow", from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, color: "#d52d00", thickness: 4 });
    steps = setOnly(steps, { type: "crop", rect: { x: 5, y: 5, width: 100, height: 100 } });
    const shown = look({ original, steps });
    expect(shown.covers).toEqual([{ rect: { x: 10, y: 20, width: 30, height: 40 }, color: "#ffffff" }]);
    expect(shown.marks).toEqual([{ type: "arrow", from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, color: "#d52d00", thickness: 4 }]);
    // the one crop is changed, not added again
    expect(setOnly(steps, { type: "crop", rect: { x: 0, y: 0, width: 50, height: 50 } }).filter((step) => step.type === "crop")).toHaveLength(1);
});

test("a step switched off does nothing until it is on again; one taken away is gone; one moved goes where it was put; the list given is never changed", () => {
    const first = add(add([], { type: "crop", rect: { x: 0, y: 0, width: 100, height: 100 } }), { type: "box", rect: { x: 1, y: 1, width: 5, height: 5 }, color: "#000000", thickness: 2 });
    const off = toggle(first, "s1");
    expect(look({ original, steps: off }).crop.width).toBe(1200);
    expect(look({ original, steps: toggle(off, "s1") }).crop.width).toBe(100);
    expect(remove(first, "s2").map((step) => step.id)).toEqual(["s1"]);
    expect(move(first, "s2", 0).map((step) => step.id)).toEqual(["s2", "s1"]);
    expect(first.map((step) => step.id)).toEqual(["s1", "s2"]);
    expect(first[0]!.off).toBeUndefined();
    expect(add(remove(first, "s1"), { type: "cover", rect: { x: 0, y: 0, width: 1, height: 1 }, color: "#000000" }).at(-1)!.id).toBe("s3");
});

test("undo and redo walk back and forth over the changes, and a new change ends what could be redone", () => {
    const history = createHistory([]);
    const one = add([], { type: "cover", rect: { x: 0, y: 0, width: 1, height: 1 }, color: "#000000" });
    history.set(one);
    history.set(remove(one, "s1"));
    expect(history.undo()).toBe(true);
    expect(history.now()).toBe(one);
    expect(history.undo()).toBe(true);
    expect(history.now()).toEqual([]);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(true);
    history.set(toggle(one, "s1"));
    expect(history.redo()).toBe(false);
    expect(history.canUndo()).toBe(true);
});

test("steps.json reads back exactly what was written, one step to a line", () => {
    let steps: Kept[] = add([], { type: "crop", rect: { x: 10, y: 10, width: 500, height: 300 } });
    steps = add(steps, { type: "resize", width: 250, filter: "bilinear" });
    steps = add(steps, { type: "text", at: { x: 40, y: 50 }, text: "Here \"it\" is", color: "#ffffff", size: 32 });
    steps = toggle(steps, "s2");
    const written = writeSteps({ original, steps });
    expect(written.split("\n").filter((line) => line.startsWith("    {"))).toHaveLength(3);
    expect(readSteps(written)).toEqual({ original, steps, dropped: 0 });
    expect(readSteps(writeSteps(fresh(original)))).toEqual({ original, steps: [], dropped: 0 });
});

test("a damaged or hostile steps.json never throws: what is not a picture's steps gives nothing, bad steps are left out and counted, and huge numbers are held in", () => {
    expect(readSteps("not json")).toBeUndefined();
    expect(readSteps("null")).toBeUndefined();
    expect(readSteps('{"quire":2,"original":{"name":"a","width":1,"height":1}}')).toBeUndefined();
    expect(readSteps('{"quire":1,"original":{"name":"a","width":0,"height":1}}')).toBeUndefined();
    expect(readSteps("x".repeat(LIMITS.file + 1))).toBeUndefined();
    const read = readSteps(JSON.stringify({ quire: 1, original, steps: [{ type: "cover", rect: { x: 0, y: 0, width: 1e300, height: 5 }, color: "#FFFFFF", id: "s9" }, { type: "cover", color: "red" }, { type: "explode" }, "s", null, { type: "text", at: { x: 1, y: 1 }, text: "y".repeat(5000), color: "#000000", size: 10, id: "s9" }, { type: "resize", width: 1e9, filter: "<script>" }] }))!;
    expect(read.dropped).toBe(4);
    expect(read.steps.map((step) => step.id)).toEqual(["s9", "s10", "s11"]);
    expect(read.steps[0]).toMatchObject({ rect: { width: LIMITS.side * 4 }, color: "#ffffff" });
    expect((read.steps[1] as { text: string }).text).toHaveLength(LIMITS.text);
    expect(read.steps[2]).toMatchObject({ width: LIMITS.side, filter: "lanczos" });
    expect(look({ original, steps: read.steps }).covers[0]!.rect.width).toBe(1200);
});

test("a file of many thousands of steps is read in a moment, and only the first few thousand are kept", () => {
    const many = Array.from({ length: 30_000 }, (_, at) => ({ type: "box", rect: { x: at, y: 0, width: 5, height: 5 }, color: "#000000", thickness: 2, id: `s${at % 7}` }));
    const text = JSON.stringify({ quire: 1, original, steps: many });
    const started = performance.now();
    const read = readSteps(text);
    expect(performance.now() - started).toBeLessThan(500);
    expect(read?.steps).toHaveLength(LIMITS.steps);
    expect(new Set(read?.steps.map((step) => step.id)).size).toBe(LIMITS.steps);
});
