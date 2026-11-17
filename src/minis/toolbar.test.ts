// The marble run's keys are held to working wherever the keyboard is in the mini: on the scene, and on
// a button just pressed, from which Space lets a marble go rather than pressing it again; while a box
// of text keeps every key for typing and a button keeps Enter and Tab. Run with `bun run test`.

import { expect, test } from "bun:test";
import { keyHeard } from "./toolbar";

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
