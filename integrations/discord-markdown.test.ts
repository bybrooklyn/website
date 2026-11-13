// The site's Markdown draws `-# subtext` and `||spoilers||` as mdQuire writes them, and leaves every
// standard piece of Markdown, code, and escaped pipes exactly as they were.

import { expect, test } from "bun:test";
import { markdownToHtml } from "satteri";
import { discordMarkdown, spoilersIn, subtextOf } from "./discord-markdown";

const html = (source: string) => {
    const result = markdownToHtml(source, { hastPlugins: [discordMarkdown] } as never) as { html?: string; output?: string } | string;
    return typeof result === "string" ? result : (result.html ?? result.output ?? "");
};
const plain = (source: string) => {
    const result = markdownToHtml(source) as { html?: string; output?: string } | string;
    return typeof result === "string" ? result : (result.html ?? result.output ?? "");
};

test("a paragraph starting -# is subtext, with the mark taken off", () => {
    expect(subtextOf("-# small print")).toBe("small print");
    expect(subtextOf("-#nospace")).toBeUndefined();
    expect(html("-# small print\n")).toContain('<p class="subtext">small print</p>');
});

test("two pipes either side of words make a spoiler that can be focused", () => {
    expect(spoilersIn("a ||b c|| d")).toEqual(["a ", { spoiler: "b c" }, " d"]);
    expect(spoilersIn("a || b || c")).toBeUndefined();
    const drawn = html("Some ||hidden|| words.\n");
    expect(drawn).toContain('class="spoiler"');
    expect(drawn).toContain('tabindex="0"');
    expect(drawn).toContain(">hidden</span>");
});

test("pipes in code and escaped pipes stay as they are", () => {
    expect(html("`a ||b|| c`\n")).not.toContain("spoiler");
    expect(html("```\na ||b|| c\n```\n")).not.toContain("spoiler");
    expect(html("a \\|\\|not hidden\\|\\| b\n")).not.toContain("spoiler");
});

test("standard Markdown comes out exactly as it would without the plugin", () => {
    for (const source of ["# Title\n\nA *b* **c** and `d`.\n", "- one\n- two\n", "| a | b |\n| - | - |\n| c || d |\n", "a || b\n", "text\n-# more\n", "> quoted\n"]) expect({ source, out: html(source) }).toEqual({ source, out: plain(source) });
});
