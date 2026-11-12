// Joining checking to the editor loads nothing of it while it has never been switched on; the
// browser test (view.test.ts) holds that it loads and works once it is.

import { expect, test } from "bun:test";
import { mountChecking } from "./mount";

test("with checking never switched on, mounting it loads nothing and touches nothing", async () => {
    const asked: string[] = [];
    const keep = { getItem: (key: string) => (asked.push(key), null), setItem: () => {} };
    // a surface and bar that would fail if anything reached for them
    const host = { surface: undefined as never, bar: undefined as never, where: () => ({ name: "Test" }), keep };
    const checking = mountChecking(host);
    await Bun.sleep(10);
    expect(asked).toEqual(["quire-check"]);
    checking.destroy();
});
