// What the text and data side is held to: Markdown and HTML become each other and data the format
// chosen, a file already in that format is told so, and each offer of a refusal makes the choice that
// lets the file through.

import { expect, test } from "bun:test";
import { optionsFor, targetOf } from "./text-side";

test("Markdown and HTML become each other, and data the format chosen, never itself", () => {
    expect(targetOf("md", "json")).toBe("html");
    expect(targetOf("html", "csv")).toBe("md");
    expect(targetOf("csv", "json")).toBe("json");
    expect(targetOf("json", "json")).toBeUndefined();
});

test("each offer makes the choice that lets its file through", () => {
    expect(optionsFor({ key: "flatten", words: "" })).toEqual({ flatten: true });
    expect(optionsFor({ key: "wrap", words: "", name: "value" })).toEqual({ wrap: "value" });
    expect(optionsFor({ key: "drop-nulls", words: "" })).toEqual({ dropNulls: true });
    expect(optionsFor({ key: "first-table", words: "" })).toEqual({ firstTable: true });
    expect(optionsFor({ key: "no-header", words: "" })).toEqual({ header: false });
});
