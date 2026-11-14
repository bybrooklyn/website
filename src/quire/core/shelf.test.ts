// What the home screen is held to: the recent documents from every place come most recently touched
// first; when each was touched is said shortly; and a copy's name keeps its ending. mdQuire's ways to
// start are held in md/kind.test.ts. The screen itself, and the page
// growing out of a row, are used in app.test.ts.

import { expect, test } from "bun:test";
import { copyName, recent, shortWhen } from "./shelf";

test("recent documents from every place come newest first, those with no time after them in their places' order, and no more than asked", () => {
    const shown = recent([
        { store: "browser", entries: [{ id: "a", name: "A", modified: 30 }, { id: "b", name: "B", modified: 10 }] },
        { store: "github", entries: [{ id: "x", name: "X" }, { id: "y", name: "Y" }] },
        { store: "folder", entries: [{ id: "f", name: "F", modified: 20 }] },
    ]);
    expect(shown.map((each) => `${each.store}:${each.id}`)).toEqual(["browser:a", "folder:f", "browser:b", "github:x", "github:y"]);
    expect(recent([{ store: 1, entries: Array.from({ length: 40 }, (_, index) => ({ id: String(index), name: String(index), modified: index })) }], 24).length).toBe(24);
    expect(recent([])).toEqual([]);
});

test("when a document was touched is said as a row has room for: the time today, yesterday, the day this year, the year before that", () => {
    const now = new Date(2026, 10, 13, 15, 30).getTime();
    expect(shortWhen(new Date(2026, 10, 13, 9, 4).getTime(), now)).toBe("today 09:04");
    expect(shortWhen(new Date(2026, 10, 12, 23, 59).getTime(), now)).toBe("yesterday");
    expect(shortWhen(new Date(2026, 10, 3, 12, 0).getTime(), now)).toBe("Nov 3");
    expect(shortWhen(new Date(2025, 0, 20, 12, 0).getTime(), now)).toBe("Jan 20, 2025");
});

test("a copy is named with copy before its ending", () => {
    expect(copyName("Plans")).toBe("Plans copy");
    expect(copyName("post.md")).toBe("post copy.md");
    expect(copyName("posts/hello.mdx")).toBe("posts/hello copy.mdx");
    expect(copyName("letter.quire")).toBe("letter copy.quire");
});
