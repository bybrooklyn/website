// What a batch is held to: a document of one picture is written byte for byte as before and a batch reads
// back what was written, each picture with its own steps; a damaged or hostile batch gives what can be read
// of it, quickly; names keep their own stems, the second of one name becomes `photo (1).webp`, and nothing in
// `taken` is ever given again; Give to all hands on a grade or a resize and never a crop, a mark or a cover;
// and a change made as one group is undone and redone on every picture that holds it at its top.

import { expect, test } from "bun:test";
import { BATCH_LIMITS, changesSaid, freeFileName, givables, giveRepair, giveStep, namesFor, ownStem, readBatch, settingsSaid, writeBatch, type BatchPicture } from "./batch";
import { add, createHistory, readSteps, writeSteps, type Kept } from "./steps";

const original = (name: string) => ({ name: `pictures/${name}`, width: 1200, height: 800, type: "image/jpeg", bytes: 52_000 });

test("a document of one picture is written exactly as steps.json always was, whatever the batch fields say", () => {
    const steps = add([], { type: "crop", rect: { x: 1, y: 2, width: 30, height: 40 } });
    const one: BatchPicture = { original: original("a.jpg"), steps, given: "a.jpg", small: "pictures/a.small.webp", export: { format: "png", quality: 1 } };
    expect(writeBatch([one])).toBe(writeSteps({ original: one.original, steps }));
    const read = readBatch(writeBatch([one]))!;
    expect(read.batch).toBe(false);
    expect(read.pictures).toEqual([{ original: one.original, steps }]);
});

test("a batch reads back each picture with its own steps, its own name, its small copy and its export settings", () => {
    const pictures: BatchPicture[] = [
        { original: original("a.jpg"), steps: add([], { type: "grade", grade: { light: 20 } }), given: "IMG 0001.JPG", small: "pictures/a.small.webp", export: { format: "webp", quality: 0.8 } },
        { original: original("b.png"), steps: [], given: "b.png", edits: { caption: "Two" } },
        { original: original("c.png"), steps: add(add([], { type: "cover", rect: { x: 0, y: 0, width: 5, height: 5 }, color: "#000000" }), { type: "resize", width: 640, filter: "lanczos" }) },
    ];
    const text = writeBatch(pictures);
    // one step to a line, so that a change to one picture is one line in a diff
    expect(text.split("\n").filter((line) => line.startsWith('        {"type"'))).toHaveLength(3);
    const read = readBatch(text)!;
    expect(read.batch).toBe(true);
    expect(read.dropped).toBe(0);
    expect(read.pictures).toEqual(pictures);
    // steps.json of a batch is not a picture's own, and the old reader says so rather than misreading it
    expect(readSteps(text)).toBeUndefined();
});

test("a damaged or hostile batch gives what can be read of it, quickly, and never throws", () => {
    const started = performance.now();
    expect(readBatch("not json")).toBeUndefined();
    expect(readBatch('{"quire":1,"pictures":[]}')).toBeUndefined();
    expect(readBatch('{"quire":1,"pictures":[null, 5, {"original":{"name":"x","width":0,"height":3}}]}')).toBeUndefined();
    const good = { original: original("a.jpg"), steps: [{ type: "crop", rect: { x: 0, y: 0, width: 5, height: 5 }, id: "s1" }], small: "../../etc/passwd", given: "x".repeat(5000), export: { format: "<script>", quality: 99 } };
    const many = { quire: 1, pictures: [null, good, ...Array.from({ length: BATCH_LIMITS.pictures + 50 }, () => ({ original: original("b.png"), steps: Array.from({ length: 50 }, () => ({ type: "cover", rect: { x: 0, y: 0, width: 1, height: 1 }, color: "#000000" })) }))] };
    const read = readBatch(JSON.stringify(many))!;
    // past the batch's whole budget of steps, the rest of the pictures are left out and counted
    expect(read.pictures.length).toBe(1 + Math.floor((BATCH_LIMITS.steps - 1) / 50) + 1);
    expect(read.pictures[0]!.small).toBeUndefined();
    expect(read.pictures[0]!.given!.length).toBe(300);
    expect(read.pictures[0]!.export).toEqual({ format: "png", quality: 0.85 });
    expect(read.pictures.reduce((sum, picture) => sum + picture.steps.length, 0)).toBeLessThanOrEqual(BATCH_LIMITS.steps + 1);
    expect(read.dropped).toBeGreaterThan(50);
    expect(readBatch("x".repeat(BATCH_LIMITS.file + 1))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(3000);
});

test("a file keeps its own name with the new ending, the second of one name becomes photo (1), and no name taken already is given", () => {
    expect(namesFor(["photo.jpg", "photo.png", "Photo.heic", "other.jpg"], ".webp")).toEqual(["photo.webp", "photo (1).webp", "Photo (2).webp", "other.webp"]);
    expect(namesFor(["photo.jpg"], ".webp", ["photo.webp", "PHOTO (1).webp"])).toEqual(["photo (2).webp"]);
    expect(namesFor(["a.jpg", "a.jpg"], [".webp", ".png"])).toEqual(["a.webp", "a.png"]);
    expect(freeFileName("a.png", () => false)).toBe("a.png");
    // a name a disk refuses is made one it takes; a name that is no name becomes "picture"
    expect(ownStem("../../x:y*?.jpg")).toBe("x-y-");
    expect(ownStem("  .hidden.  ")).toBe("hidden");
    expect(ownStem(undefined)).toBe("picture");
    expect(ownStem("con.png")).toBe("con-file");
    expect(ownStem("my holiday photo.HEIC")).toBe("my holiday photo");
});

test("Give to all hands on a grade or a resize exactly as set, and never touches a crop, a cover, a mark or a part", () => {
    let mine: Kept[] = add([], { type: "grade", grade: { light: 30 } });
    mine = add(mine, { type: "resize", width: 1920, filter: "lanczos" });
    mine = add(mine, { type: "crop", rect: { x: 0, y: 0, width: 10, height: 10 } });
    let theirs: Kept[] = add([], { type: "crop", rect: { x: 5, y: 5, width: 50, height: 50 } });
    theirs = add(theirs, { type: "cover", rect: { x: 1, y: 1, width: 2, height: 2 }, color: "#ffffff" });
    theirs = add(theirs, { type: "arrow", from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, color: "#000000", thickness: 2 });
    theirs = add(theirs, { type: "grade", grade: { light: -10 } });
    const graded = giveStep(theirs, mine, "grade");
    expect(graded.find((step) => step.type === "grade")).toMatchObject({ grade: { light: 30 } });
    const resized = giveStep(graded, mine, "resize");
    expect(resized.find((step) => step.type === "resize")).toMatchObject({ width: 1920 });
    for (const kind of ["crop", "cover", "arrow"]) expect(resized.find((step) => step.type === kind)).toEqual(theirs.find((step) => step.type === kind)!);
    // a kind it does not have leaves theirs alone
    expect(giveStep(theirs, [], "grade")).toBe(theirs);
    expect(giveRepair(theirs).filter((step) => step.type === "repair")).toHaveLength(1);
    expect(givables({ original: original("a.jpg"), steps: mine })).toEqual(["grade", "resize", "export"]);
    expect(changesSaid({ original: original("a.jpg"), steps: mine, export: { format: "jpeg", quality: 0.8, target: 200_000 } }, { format: "webp", quality: 0.85 })).toBe("the grade, 1920 wide, JPEG under 200 KB");
    expect(settingsSaid({ format: "png", quality: 1 })).toBe("PNG");
});

test("a change made as one group is undone and redone on each picture that holds it at its top", () => {
    const pictures = [createHistory([]), createHistory([]), createHistory([])];
    const cover = add([], { type: "cover", rect: { x: 0, y: 0, width: 1, height: 1 }, color: "#000000" });
    pictures[1]!.set(cover);
    for (const history of pictures) history.set(add(history.now(), { type: "grade", grade: { light: 10 } }), 7);
    // the second picture changed again after the group, so its top is its own change
    pictures[2]!.set(add(pictures[2]!.now(), { type: "crop", rect: { x: 0, y: 0, width: 3, height: 3 } }));
    expect(pictures.map((history) => history.undoGroup())).toEqual([7, 7, undefined]);
    for (const history of pictures) if (history.undoGroup() === 7) history.undo();
    expect(pictures[0]!.now()).toEqual([]);
    expect(pictures[1]!.now()).toBe(cover);
    expect(pictures.map((history) => history.redoGroup())).toEqual([7, 7, undefined]);
    for (const history of pictures) if (history.redoGroup() === 7) history.redo();
    expect(pictures[0]!.now().map((step) => step.type)).toEqual(["grade"]);
    expect(pictures[1]!.undoGroup()).toBe(7);
    pictures[1]!.undo();
    expect(pictures[1]!.undoGroup()).toBeUndefined();
});
