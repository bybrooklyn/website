// Joining checking to the editor loads nothing of it while she has switched it off, and offers no
// lines for the text's menu until it has loaded; the browser test (view.test.ts) holds that it loads
// and works at once for a writer who never set it, and once switched on for one who switched it off.

import { expect, test } from "bun:test";
import { mountChecking } from "./mount";

test("with checking switched off, mounting it loads nothing and touches nothing", async () => {
    const asked: string[] = [];
    const keep = { getItem: (key: string) => (asked.push(key), JSON.stringify({ on: false })), setItem: () => {} };
    // a surface and bar that would fail if anything reached for them
    const host = { surface: undefined as never, bar: undefined as never, where: () => ({ name: "Test" }), keep };
    const checking = mountChecking(host);
    await Bun.sleep(10);
    expect(asked).toEqual(["quire-check"]);
    expect(checking.linesAt({ x: 10, y: 10 })).toEqual({ lines: [], strong: 0 });
    checking.destroy();
});
