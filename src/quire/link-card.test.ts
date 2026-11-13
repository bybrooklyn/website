// Which pasted text counts as a web address, to link selected words with. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { webAddress } from "./link-card";

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
