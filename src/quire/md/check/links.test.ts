// Links and pictures: anchors made as the site makes them, a link to a missing heading, a relative
// address or a site page the store says is not there, and web addresses elsewhere never asked about.

import { expect, test } from "bun:test";
import { read } from "../read";
import { check, DEFAULTS } from "./engine";
import { addressKind, fileOf, LINKS, slug } from "./links";

const asked: string[] = [];
const exists = (address: string) => {
    asked.push(address);
    return address === "there.md" || address === "../pics/cat.png" || address === "/blog/real/" ? true : address === "waiting.md" ? undefined : false;
};
const found = (markdown: string) => check(read(markdown), { settings: DEFAULTS, exists }, LINKS).map((one) => one.message);

test("anchors are made as the site makes them", () => {
    expect(slug("Hello, World!")).toBe("hello-world");
    expect(slug("Five versions of this site")).toBe("five-versions-of-this-site");
    expect(slug("What’s new in 2.0?")).toBe("whats-new-in-20");
    expect(addressKind("https://example.com")).toBe("elsewhere");
    expect(addressKind("mailto:me@example.com")).toBe("elsewhere");
    expect(addressKind("#top")).toBe("anchor");
    expect(addressKind("/blog/x/")).toBe("site");
    expect(addressKind("pics/cat.png")).toBe("relative");
    expect(fileOf("notes%20one.md#part")).toBe("notes one.md");
});

test("a link to a heading the document does not have", () => {
    expect(found("## Setup\n\nSee [setup](#setup) and [missing](#nowhere).\n")).toEqual(["This document has no heading for #nowhere."]);
    expect(found("## Twice\n\n## Twice\n\nSee [second](#twice-1).\n")).toEqual([]);
});

test("relative files and site pages, as the store answers", () => {
    expect(found("[a](there.md) [b](gone.md) ![c](../pics/cat.png) [d](waiting.md) [e](/blog/real/) [f](/blog/fake/)\n")).toEqual(["This link points at gone.md, which is not there.", "The site has no page at /blog/fake/."]);
    expect(found("![](missing.png)\n")).toEqual(["This picture points at missing.png, which is not there."]);
});

test("web addresses elsewhere are never asked about", () => {
    asked.length = 0;
    expect(found("[a](https://example.com/nothing) [b](mailto:x@y.z)\n")).toEqual([]);
    expect(asked).toEqual([]);
});

test("with no way to ask, only anchors are checked", () => {
    expect(check(read("[a](gone.md) [b](#gone)\n"), { settings: DEFAULTS }, LINKS).map((one) => one.message)).toEqual(["This document has no heading for #gone."]);
});
