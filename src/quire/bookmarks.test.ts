// What bookmarks are held to: one is written as an empty anchor and read back as one thing in the
// text; its name is made as a heading's id is and never repeats one; and the places offered to link
// to are the headings, by the ids the site gives them, then the bookmarks. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { addBookmark, bookmarkName, freeName, places, suggestedName } from "./bookmarks";
import { caret } from "./keys";
import { read } from "./read";
import { write } from "./write";

test("a bookmark is written as an empty anchor and read back as one thing in the text, wherever it stands", () => {
    const added = addBookmark("The quiet part")({ doc: read("Some words here.\n"), selection: caret([0], 4) });
    expect(write(added.doc)).toBe('Some<a id="the-quiet-part"></a> words here.\n');
    expect(added.selection).toEqual(caret([0], 5));
    for (const markdown of ['<a id="start"></a>Text\n', 'Text <a id="x"></a>\n', '| a <a id="c"></a> |\n| --- |\n']) {
        const doc = read(markdown);
        expect(write(doc)).toBe(markdown);
        expect(places(doc).filter((place) => place.kind === "bookmark")).toHaveLength(1);
    }
    expect(bookmarkName('<a name="old"></a>')).toBe("old");
    expect(bookmarkName('<a href="/x"></a>')).toBeUndefined();
});

test("the places to link to are the headings by the site's ids, then the bookmarks", () => {
    const doc = read('# Hello, World!\n\n## Hello, World!\n\nA line <a id="here"></a>.\n\n## \n');
    expect(places(doc)).toEqual([
        { label: "Hello, World!", href: "#hello-world", kind: "heading" },
        { label: "Hello, World!", href: "#hello-world-1", kind: "heading" },
        { label: "here", href: "#here", kind: "bookmark" },
    ]);
});

test("a bookmark's name never repeats a heading's id or another bookmark's, and is offered from the words at the cursor", () => {
    const doc = read('## Notes\n\nNotes again <a id="notes-2"></a>\n');
    expect(freeName(doc, "Notes")).toBe("notes-3");
    expect(freeName(doc, "!!!")).toBe("bookmark");
    expect(suggestedName({ doc: read("One two three four five\n"), selection: caret([0], 2) })).toBe("one-two-three-four");
    expect(suggestedName({ doc: read("One two three\n"), selection: { anchor: { path: [0], offset: 4 }, focus: { path: [0], offset: 7 } } })).toBe("two");
});
