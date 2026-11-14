// What mdQuire gives the core's app as a kind of document: its key and name, its names and ways to
// start (starts.ts, held in starts.test.ts), the sample offered quietly when the page gives one, and
// what the file choosers offer. Its editor in the app is used in core/app.test.ts and note/note.test.ts.

import { expect, mock, test } from "bun:test";

// the editor brings dictation in, whose worklet is a file the bundler makes (capture.test.ts does the same)
mock.module("./dictation/capture-worklet.ts?worker&url", () => ({ default: "capture-worklet.js" }));
const { markdown } = await import("./kind");

test("mdQuire is the kind md, named mdQuire, opening Markdown, text and .quire files", () => {
    const kind = markdown();
    expect([kind.key, kind.name]).toEqual(["md", "mdQuire"]);
    expect(["post.md", "Untitled", "Letter.quire"].map(kind.opens)).toEqual([true, true, true]);
    expect(kind.files.chooser).toBe(".md,.mdx,.markdown,.txt,.quire,text/markdown,text/plain");
    expect(kind.starts(new Date()).map((each) => each.label)).toEqual(["blank", "blog post", "notes", "meeting notes", "changelog entry", "project page"]);
});

test("the sample is offered quietly only when the page gives one", () => {
    expect(markdown().quiet?.()).toEqual([]);
    expect(markdown({ sample: "# A sample\n" }).quiet?.()).toEqual([{ key: "sample", label: "see a sample", name: "A sample", text: "# A sample\n", quire: true }]);
});
