// What the link card and the chip are held to: which pasted text counts as a web address, the words
// guessed from an address with nothing fetched, its short form, and showing a pasted address as a
// link with other words. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { read } from "./read";
import { write } from "./write";
import { cutMiddle, shortFor, showAs, webAddress, wordsFor } from "./link-card";

test("a web address is http, https or mailto alone, trimmed; other schemes and text around it are not", () => {
    expect(webAddress("  https://github.com/anomalyco/rune \n")).toBe("https://github.com/anomalyco/rune");
    expect(webAddress("HTTP://example.com")).toBe("HTTP://example.com");
    expect(webAddress("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    expect(webAddress("javascript:alert(1)")).toBeUndefined();
    expect(webAddress("JavaScript://example.com/%0Aalert(1)")).toBeUndefined();
    expect(webAddress("data:text/html,<b>x</b>")).toBeUndefined();
    expect(webAddress("ftp://example.com/file")).toBeUndefined();
    expect(webAddress("see https://example.com")).toBeUndefined();
    expect(webAddress("https://example.com and more")).toBeUndefined();
    expect(webAddress("https://example.com\nhttps://example.org")).toBeUndefined();
    expect(webAddress("https://")).toBeUndefined();
    expect(webAddress("example.com")).toBeUndefined();
    expect(webAddress("mailto:nobody")).toBeUndefined();
    expect(webAddress('https://example.com/"><script>')).toBeUndefined();
});

test("the words guessed for GitHub and GitLab are the repository, and its issue or request", () => {
    expect(wordsFor("https://github.com/anomalyco/rune")).toBe("Rune");
    expect(wordsFor("https://github.com/anomalyco/rune/issues/12")).toBe("Rune issue 12");
    expect(wordsFor("https://github.com/anomalyco/rune/pull/7")).toBe("Rune pull request 7");
    expect(wordsFor("https://gitlab.com/group/my-project/-/issues/5")).toBe("My project issue 5");
    expect(wordsFor("https://gitlab.com/group/my-project/-/merge_requests/9")).toBe("My project merge request 9");
    expect(wordsFor("https://github.com/anomalyco")).toBe("Anomalyco");
    expect(wordsFor("https://github.com/")).toBe("GitHub");
});

test("a video's words say what it is, as its title cannot be fetched", () => {
    expect(wordsFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("YouTube video");
    expect(wordsFor("https://youtu.be/dQw4w9WgXcQ")).toBe("YouTube video");
});

test("a Wikipedia article's underscores are spaces and its percent signs the letters they stand for", () => {
    expect(wordsFor("https://en.wikipedia.org/wiki/Ada_Lovelace")).toBe("Ada Lovelace");
    expect(wordsFor("https://fr.wikipedia.org/wiki/Caf%C3%A9_au_lait")).toBe("Café au lait");
});

test("a bare domain gives the site's name, and the ending co.uk and the like are passed over", () => {
    expect(wordsFor("https://example.com")).toBe("Example");
    expect(wordsFor("https://www.bbc.co.uk/")).toBe("Bbc");
    expect(wordsFor("https://stackoverflow.com")).toBe("Stack Overflow");
});

test("the last part of the path that is words is used, with no query, fragment, ending, id or number", () => {
    expect(wordsFor("https://example.com/blog/my-great-post/?utm_source=news&utm_medium=email&fbclid=AbC123")).toBe("My great post");
    expect(wordsFor("https://example.com/docs/getting-started.html#install-on-linux")).toBe("Getting started");
    expect(wordsFor("https://example.com/2024/05/")).toBe("Example");
    expect(wordsFor("https://medium.com/@someone/why-it-works-3f2a9c1b7d4e")).toBe("Why it works");
    expect(wordsFor("https://example.com/posts/a8F3kQ92xZ")).toBe("Posts");
    expect(wordsFor("https://example.com/Read_Me")).toBe("Read Me");
});

test("paths in other scripts come back as their letters", () => {
    expect(wordsFor("https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC")).toBe("東京");
    expect(wordsFor("https://example.ru/%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F-%D0%BE-%D0%BB%D0%B5%D1%81%D0%B5")).toBe("Статья о лесе");
    expect(wordsFor("mailto:someone@example.com")).toBe("someone@example.com");
});

test("the short form is host and path, and a long address is cut in the middle", () => {
    expect(shortFor("https://www.github.com/anomalyco/rune/?tab=readme#top")).toBe("github.com/anomalyco/rune");
    expect(shortFor("https://example.com/")).toBe("example.com");
    expect(shortFor("https://example.com/a/very/long/path/that/goes/on/and/on/forever", 30)).toBe("example.com/a/v…and/on/forever");
    expect(cutMiddle("short", 10)).toBe("short");
    expect([...cutMiddle("x".repeat(100), 40)]).toHaveLength(40);
});

test("a pasted address shown with words becomes a link with them, and does nothing once the text there has changed", () => {
    const href = "https://github.com/anomalyco/rune";
    const doc = read(`See ${href} now\n`);
    const range = { start: { path: [0], offset: 4 }, end: { path: [0], offset: 4 + href.length } };
    const shown = showAs(doc, range, href, "Rune");
    expect(write(shown.doc)).toBe(`See [Rune](${href}) now\n`);
    expect(shown.selection.focus).toEqual({ path: [0], offset: 8 });
    const changed = read("See something else entirely now, longer than the address was\n");
    expect(showAs(changed, range, href, "Rune").doc).toBe(changed);
});
