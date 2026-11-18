// The marble run's keys are held to working wherever the keyboard is in the mini: on the scene, and on
// a button just pressed, from which Space lets a marble go rather than pressing it again; while a box
// of text keeps every key for typing and a button keeps Enter and Tab. Run with `bun run test`.

import { expect, test } from "bun:test";
import { isBuildKey, keyHeard } from "./toolbar";

test("every key the mini names is heard on the scene and on a button just pressed, Space among them", () => {
    for (const key of [" ", "r", "R", "p", "Delete", "Home", "z", "7", "ArrowLeft", "Escape", "?"]) {
        expect(keyHeard(key, "canvas")).toBe(true);
        expect(keyHeard(key, "button")).toBe(true);
    }
    expect(keyHeard("Enter", "canvas")).toBe(true);
});

test("a button keeps Enter and Tab, the keyboard's way to press it and move on; a box of text keeps every key", () => {
    expect(keyHeard("Enter", "button")).toBe(false);
    expect(keyHeard("Tab", "button")).toBe(false);
    expect(keyHeard("Tab", "canvas")).toBe(false);
    for (const key of [" ", "r", "1", "Home", "Delete", "Enter", "z"]) expect(keyHeard(key, "text")).toBe(false);
});

test("in play the keys that build do nothing, and every key for watching works", () => {
    const building: [string, boolean][] = [["r", false], ["f", false], ["n", false], ["j", false], ["b", false], ["k", false], ["PageUp", false], ["PageDown", false], ["Delete", false], ["Backspace", false], [",", false], [".", false], ["z", true], ["y", true], ["a", true], ["c", true], ["x", true], ["v", true], ["d", true]];
    for (const [key, ctrl] of building) expect({ key, ctrl, builds: isBuildKey(key, key.toLowerCase(), ctrl) }).toEqual({ key, ctrl, builds: true });
    for (const key of [" ", "p", "c", "x", "v", "t", "h", "g", "7", "1", "3", "5", "Home", "+", "-", "w", "a", "s", "d", "ArrowLeft", "m", "?", "l", "Escape"]) {
        expect({ key, builds: isBuildKey(key, key.toLowerCase(), false) }).toEqual({ key, builds: false });
    }
});
