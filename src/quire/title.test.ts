import { describe, expect, test } from "bun:test";
import { nameFor, shownName } from "./title";

describe("shownName", () => {
    test("a file's title is its name without the extension", () => {
        expect(shownName("first-post.md")).toBe("first-post");
        expect(shownName("notes.MDX")).toBe("notes");
        expect(shownName("list.txt")).toBe("list");
        expect(shownName("A letter.quire")).toBe("A letter");
    });

    test("a name without one is shown as it is", () => {
        expect(shownName("Untitled")).toBe("Untitled");
        expect(shownName("v1.2 plans")).toBe("v1.2 plans");
    });
});

describe("nameFor", () => {
    test("keeps the extension the document had", () => {
        expect(nameFor("first-post.md", "second post")).toBe("second post.md");
        expect(nameFor("Untitled", "My plans")).toBe("My plans");
    });

    test("nothing typed is Untitled, and spaces are tidied", () => {
        expect(nameFor("a.md", "   ")).toBe("Untitled.md");
        expect(nameFor("Draft", "  two   words ")).toBe("two words");
    });
});
