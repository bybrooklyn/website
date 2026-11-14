// The linter's rule for where the Quires' code may reach: the core never imports from a kind of document, and no kind from another.

import { expect, test } from "bun:test";
import { crossing, quireFolder } from "./lint-bounds";

test("a file's folder of src/quire/ is the core's, a kind's, or none", () => {
    expect(quireFolder("src/quire/core/app.ts")).toBe("core");
    expect(quireFolder("src/quire/md/check/tells.ts")).toBe("md");
    expect(quireFolder("src/mote/stage.ts")).toBeUndefined();
});

test("the core may not import from mdQuire or any other kind", () => {
    expect(crossing("src/quire/core/app.ts", "../md/editor")).toBe("the core imports from md/, a kind of document");
    expect(crossing("src/quire/core/app.ts", "../note/note")).toBe("the core imports from note/, a kind of document");
});

test("the core may import from itself, and a kind from the core", () => {
    expect(crossing("src/quire/core/app.ts", "./shelf")).toBeUndefined();
    expect(crossing("src/quire/md/editor.ts", "../core/ui")).toBeUndefined();
    expect(crossing("src/quire/md/check/mount.ts", "../../core/dialog")).toBeUndefined();
    expect(crossing("src/quire/md/check/mount.ts", "./view")).toBeUndefined();
});

test("a file at the top of src/quire/ is held as the core is", () => {
    expect(crossing("src/quire/loose.ts", "./md/editor")).toBe("the core imports from md/, a kind of document");
});

test("one kind may not import from another", () => {
    expect(crossing("src/quire/note/note.ts", "../md/surface")).toBe("note/ imports from md/, another kind of document");
});

test("a test may bring a kind in, and a library is another rule's business", () => {
    expect(crossing("src/quire/core/app.test.ts", "../md/editor")).toBeUndefined();
    expect(crossing("src/quire/core/app.ts", "onnxruntime-web")).toBeUndefined();
});
