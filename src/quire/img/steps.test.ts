// What the picture document is held to: the steps apply in order to give the picture as it looks,
// in the original's pixels, so a cover or a mark stays put when an earlier crop changes; steps are
// changed, taken away, moved and switched off without touching the list given; undo and redo walk
// the changes; steps.json reads back what was written, and a damaged or hostile file gives what can
// be read of it, quickly, and never throws.

import { expect, test } from "bun:test";
import { encodeRuns } from "./masks";
import { add, change, createHistory, edited, fresh, LIMITS, look, move, readSteps, remove, setOnly, toggle, within, writeSteps, type Kept } from "./steps";

const original = { name: "pictures/cat.png", width: 1200, height: 800, type: "image/png", bytes: 52_000 };

test("with no steps the picture looks as the original does, whole and at its own size", () => {
    expect(look(fresh(original))).toEqual({ crop: { x: 0, y: 0, width: 1200, height: 800 }, width: 1200, height: 800, filter: "lanczos", covers: [], marks: [], grades: [] });
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

test("what she wrote for the metadata is kept in steps.json and read back, each field text and bounded", () => {
    const picture = { original, steps: [], edits: { caption: "A cat", author: "Someone" } };
    expect(readSteps(writeSteps(picture))).toEqual({ ...picture, dropped: 0 });
    expect(readSteps(JSON.stringify({ quire: 1, original, steps: [], edits: { caption: 5, author: "x".repeat(5000), evil: "y" } }))!.edits).toEqual({ author: "x".repeat(2000) });
});

test("the whole picture's grade is one step, kept with only what is away from its zero, set where it is and read back the same, its hostile numbers held in", () => {
    const one = setOnly([], { type: "grade", grade: { light: 20 } });
    const two = setOnly(one, { type: "grade", grade: { light: 30, curves: { red: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] } } });
    expect(two).toHaveLength(1);
    const picture = { original, steps: two };
    const shown = look(picture);
    expect(shown.grades).toHaveLength(1);
    expect(shown.grades[0]!.grade.light).toBe(30);
    expect(shown.grades[0]!.grade.contrast).toBe(0);
    // drawn again from the same step, the grade is the same object, so nothing is worked out twice
    expect(look(picture).grades[0]!.grade).toBe(shown.grades[0]!.grade);
    expect(edited(picture)).toBe(true);
    const back = readSteps(writeSteps(picture))!;
    expect(back.steps).toEqual(two);
    const hostile = readSteps(JSON.stringify({ quire: 1, original, steps: [{ id: "s1", type: "grade", grade: { light: 1e99, color: "lots", curves: { all: "no" } } }] }))!;
    expect(hostile.steps[0]).toEqual({ id: "s1", type: "grade", grade: { light: 100 } });
});

test("a part keeps its shape and its own grade in steps.json, comes back the same, is in the look's grades after the whole picture's, and a hostile one is held in or left out", () => {
    const steps = add(add(setOnly([], { type: "grade", grade: { light: 10 } }), { type: "part", kind: "gradient", from: { x: 0, y: 0 }, to: { x: 0, y: 400 }, feather: 12, grade: { light: -40 } }), { type: "part", kind: "paint", strokes: [{ size: 30, soft: 0.5, points: [10, 10, 40, 40] }, { size: 10, soft: 0, erase: true, points: [20, 20] }], feather: 0, invert: true, grade: { color: 30 } });
    const picture = { original, steps };
    const back = readSteps(writeSteps(picture))!;
    expect(back.steps).toEqual(steps);
    const shown = look(picture);
    expect(shown.grades.map((each) => each.id)).toEqual(["s1", "s2", "s3"]);
    expect(shown.grades[1]!.part).toEqual({ kind: "gradient", from: { x: 0, y: 0 }, to: { x: 0, y: 400 }, feather: 12 });
    expect(shown.grades[2]!.part!.invert).toBe(true);
    expect(shown.grades[2]!.grade.color).toBe(30);
    const hostile = readSteps(JSON.stringify({ quire: 1, original, steps: [
        { id: "s1", type: "part", kind: "gradient", from: { x: 0, y: 0 }, feather: 1 },
        { id: "s2", type: "part", kind: "found", found: { width: 4, height: 4, runs: "AAAA" }, feather: 0 },
        { id: "s3", type: "part", kind: "paint", strokes: [{ size: 1e9, points: [1, 2, 3] }, { size: 5, points: Array.from({ length: 20_000 }, () => 1) }], feather: -5, grade: { light: 500 } },
        { id: "s4", type: "part", kind: "magic", feather: 0 },
    ] }))!;
    expect(hostile.steps.map((step) => step.id)).toEqual(["s3"]);
    const part = hostile.steps[0] as Extract<Kept, { type: "part" }>;
    expect(part.strokes).toHaveLength(1);
    expect(part.strokes![0]!.points).toHaveLength(8_000);
    expect(part.feather).toBe(0);
    expect(part.grade).toEqual({ light: 100 });
});

test("a turn levels the picture: its crop is the largest upright rectangle inside it, a crop of her own is fitted inside, and steps.json keeps the turn and a cover's own turn, bounded", () => {
    const turned = look({ original, steps: [{ id: "s1", type: "turn", angle: 5 }] });
    expect(turned.turn).toBe(5);
    expect(turned.crop.width).toBeLessThan(1200);
    expect(turned.width).toBe(turned.crop.width);
    // a crop of her own reaching past the turned picture is made smaller about its middle
    const cropped = look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 0, y: 0, width: 600, height: 400 } }, { id: "s2", type: "turn", angle: -5 }] });
    expect(cropped.crop.width).toBeLessThan(600);
    expect(Math.abs(cropped.crop.width / cropped.crop.height - 1.5)).toBeLessThan(0.01);
    // at no turn the picture is as it was
    expect(look({ original, steps: [{ id: "s1", type: "turn", angle: 0 }] }).crop).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    const picture = { original, steps: [{ id: "s1", type: "turn", angle: 4.25 }, { id: "s2", type: "cover", rect: { x: 10, y: 10, width: 50, height: 20 }, color: "#123456", angle: -4.25 }] as Kept[] };
    expect(readSteps(writeSteps(picture))!.steps).toEqual(picture.steps);
    const wild = readSteps('{"quire": 1, "original": {"name": "a.png", "width": 10, "height": 10}, "steps": [{"type": "turn", "angle": 400}, {"type": "box", "rect": {"x": 0, "y": 0, "width": 4, "height": 4}, "color": "#ffffff", "thickness": 2, "angle": "x"}]}')!;
    expect(wild.steps[0]).toEqual({ id: "s1", type: "turn", angle: 15 });
    expect("angle" in wild.steps[1]!).toBe(false);
});

test("a cut-out step reads back from steps.json with its mask, strokes and background, and a damaged one is left out", () => {
    const found = { width: 2, height: 1, runs: encodeRuns(Uint8Array.of(255, 0)) };
    const picture = { original, steps: [{ id: "s1", type: "cutout", found, strokes: [{ size: 8, soft: 0.5, erase: true, points: [1, 2] }], background: "color", color: "#ffffff" }] as Kept[] };
    const read = readSteps(writeSteps(picture))!;
    expect(read.steps).toEqual(picture.steps);
    expect(look(read).cutout).toEqual({ found, strokes: [{ size: 8, soft: 0.5, erase: true, points: [1, 2] }], background: "color", color: "#ffffff" });
    const bad = readSteps('{"quire": 1, "original": {"name": "a.png", "width": 10, "height": 10}, "steps": [{"type": "cutout", "found": {"width": 4, "height": 4, "runs": "AAAA"}, "background": "sky"}]}')!;
    expect(bad.steps).toEqual([]);
    expect(bad.dropped).toBe(1);
});

