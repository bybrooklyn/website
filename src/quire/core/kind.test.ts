// Which kind a document is, as the app asks it: every kind but the first is asked in turn, and the
// first takes whatever none of them claims. The kinds on the app are used in note/note.test.ts.

import { expect, test } from "bun:test";
import { kindFor } from "./kind";

const first = { key: "first", opens: () => true };
const note = { key: "note", opens: (name: string) => name.endsWith(".note") };
const picture = { key: "picture", opens: (name: string) => /\.(png|jpe?g)$/.test(name) };

test("a document of another kind's ending is that kind's, asked in the order the kinds are listed", () => {
    expect(kindFor([first, note, picture], "Today.note").key).toBe("note");
    expect(kindFor([first, note, picture], "cat.png").key).toBe("picture");
});

test("the first kind takes what no other claims, even when it would say no itself", () => {
    expect(kindFor([first, note], "Untitled").key).toBe("first");
    expect(kindFor([{ key: "picky", opens: () => false }, note], "letter.odt").key).toBe("picky");
});

test("a .quire naming its main file is the kind that keeps its text there, whatever its name; one naming none goes by its name", () => {
    const steps = { key: "steps", opens: () => false, main: "steps.json" };
    expect(kindFor([first, note, steps], "cat.quire", "steps.json").key).toBe("steps");
    expect(kindFor([first, note, steps], "Screenshot", "steps.json").key).toBe("steps");
    expect(kindFor([first, note, steps], "letter.quire").key).toBe("first");
    expect(kindFor([first, note], "odd.quire", "unknown.json").key).toBe("first");
});
