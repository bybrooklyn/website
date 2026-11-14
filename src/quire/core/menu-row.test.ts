// What the menu row holds to as the core's: Alt and a menu's letter, as in Docs, opens that word's
// menu from the writing, whatever words a kind of document gives. The row itself is used in
// app.test.ts, and mdQuire's menus are held in md/menus.test.ts. Run with `bun test src/quire/core`.

import { expect, test } from "bun:test";
import { letterOf, menuFor } from "./menu-row";

test("Alt and a menu's letter opens it, as in Docs, Ctrl+Option on a Mac, and F10 opens File; Alt with anything else is not a menu", () => {
    const key = (code: string, held: Partial<{ altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = { altKey: true }) => ({ key: code.replace("Key", "").toLowerCase(), code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...held });
    expect(["KeyF", "KeyE", "KeyV", "KeyI", "KeyO", "KeyT", "KeyH"].map((code) => menuFor(key(code)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(menuFor(key("KeyB"))).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, shiftKey: true }))).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(menuFor(key("KeyF"), true)).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, ctrlKey: true }), true)).toBe(0);
    expect(menuFor({ ...key("F10", {}), key: "F10" })).toBe(0);
});

test("a kind with other words opens each by its first letter, Format by O as Docs has it", () => {
    expect(["File", "Edit", "Format", "Help"].map(letterOf)).toEqual(["F", "E", "O", "H"]);
    const key = (code: string) => ({ key: code.replace("Key", "").toLowerCase(), code, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false });
    expect(menuFor(key("KeyE"), false, ["File", "Edit"])).toBe(1);
    expect(menuFor(key("KeyV"), false, ["File", "Edit"])).toBeUndefined();
});
