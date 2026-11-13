// What the scripts share. Held true: a frontmatter value is read from the frontmatter only, without
// its quotes (double or single) or a comment after it.

import { expect, test } from "bun:test";
import { frontmatter } from "./lib";

const POST = ["---", 'title: "A post"', "summary: 'Single quoted'", "draft: true # until it is read over", "cover:", "tags: [a, b]", "---", "", "A code sample:", "", "```yaml", "draft: false", "repo: someone/else", "```", ""].join("\n");

test("a value is read from the frontmatter, not from a line of the same shape in the text", () => {
    expect(frontmatter(POST, "repo")).toBeUndefined();
    expect(frontmatter("---\ntitle: One\n---\n\ndraft: true\n", "draft")).toBeUndefined();
    expect(frontmatter("No frontmatter here.\ndraft: true\n", "draft")).toBeUndefined();
});

test("quotes of either kind and a comment after the value are taken off", () => {
    expect(frontmatter(POST, "title")).toBe("A post");
    expect(frontmatter(POST, "summary")).toBe("Single quoted");
    expect(frontmatter(POST, "draft")).toBe("true");
    expect(frontmatter('---\ntitle: "C# # notes" # a comment\n---\n', "title")).toBe("C# # notes");
    expect(frontmatter("---\nlanguage: C#\n---\n", "language")).toBe("C#");
});

test("a key with nothing after it on its line has no value, and the next line is not taken for one", () => {
    expect(frontmatter(POST, "cover")).toBeUndefined();
    expect(frontmatter(POST, "tags")).toBe("[a, b]");
});
