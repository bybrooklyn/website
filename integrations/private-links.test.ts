// Tests that a link into a private repository is found, however deep, and a look-alike name is not.

import { expect, test } from "bun:test";
import { linksTo } from "./private-links";

test("a link to the repository itself is found, in either case", () => {
    expect(linksTo(`<a href="https://github.com/me/thing">`, "me/thing")).toBe(true);
    expect(linksTo(`<a href="https://github.com/Me/Thing">`, "me/thing")).toBe(true);
});

test("a link to something inside the repository is found", () => {
    expect(linksTo(`<a href="https://github.com/me/thing/releases">`, "me/thing")).toBe(true);
    expect(linksTo(`<a href="https://github.com/me/thing/tree/main/src">`, "me/thing")).toBe(true);
    expect(linksTo(`<a href="https://github.com/me/thing#readme">`, "me/thing")).toBe(true);
    expect(linksTo(`<a href="https://github.com/me/thing?tab=readme">`, "me/thing")).toBe(true);
    expect(linksTo(`<a href=https://github.com/me/thing>`, "me/thing")).toBe(true);
});

test("another repository whose name starts the same is not taken for it", () => {
    expect(linksTo(`<a href="https://github.com/me/thing-two">`, "me/thing")).toBe(false);
    expect(linksTo(`<a href="https://github.com/me/thingy/releases">`, "me/thing")).toBe(false);
    expect(linksTo(`<a href="https://github.com/me">`, "me/thing")).toBe(false);
});

test("a dot in a name is matched as a dot", () => {
    expect(linksTo(`<a href="https://github.com/me/site.dev">`, "me/site.dev")).toBe(true);
    expect(linksTo(`<a href="https://github.com/me/siteXdev">`, "me/site.dev")).toBe(false);
});
