// The shortcut table is held to being one table: no two shortcuts share keys, every menu line with a
// shortcut shows the table's keys, a shortcut the surface keeps is one keys.ts really handles, and
// the keys are read the same from a key press as from the table. That every other shortcut runs its
// command when pressed is held in editor.test.ts, in a browser.

import { expect, test } from "bun:test";
import { documentOf, paragraph } from "./document";
import { caret, handle } from "./keys";
import { headings, type Command, type RowActions } from "./menu-row";
import { chordFrom, chordOf, findShortcuts, keysFor, SHORTCUTS, shortcutFor } from "./shortcuts";

test("no two shortcuts with a command share the same keys, unless they run the same command", () => {
    const seen = new Map<string, Command>();
    for (const each of SHORTCUTS) {
        if (!each.command) continue;
        const chord = JSON.stringify(chordOf(each.keys));
        if (seen.has(chord)) expect({ keys: each.keys, command: seen.get(chord) }).toEqual({ keys: each.keys, command: each.command });
        seen.set(chord, each.command);
    }
});

test("a key press is read as the table's keys, by the key's place so that Shift does not change it, Cmd for Ctrl on a Mac", () => {
    expect(shortcutFor(chordFrom({ code: "Digit8", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }))?.command).toBe("bullet");
    expect(shortcutFor(chordFrom({ code: "Digit8", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }, true))?.command).toBe("bullet");
    expect(shortcutFor(chordFrom({ code: "Period", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }))?.command).toBe("bigger");
    expect(shortcutFor(chordFrom({ code: "Digit5", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true }))?.command).toBe("strike");
    expect(shortcutFor(chordFrom({ code: "Backslash", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }))?.command).toBe("clear");
    expect(shortcutFor(chordFrom({ code: "BracketRight", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }))?.command).toBe("indent");
    // Ctrl on a Mac is not Cmd: nothing
    expect(shortcutFor(chordFrom({ code: "Digit8", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, true))).toBeUndefined();
});

test("every shortcut the surface keeps is one the keys of the surface really handle", () => {
    const state = { doc: documentOf([paragraph("words")]), selection: { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 5 } } };
    for (const each of SHORTCUTS.filter((shortcut) => shortcut.surface)) {
        const chord = chordOf(each.keys);
        const key = chord.code.startsWith("Key") ? chord.code.slice(3).toLowerCase() : chord.code.startsWith("Digit") ? chord.code.slice(5) : { Period: ".", Comma: ",", Enter: "Enter" }[chord.code] ?? chord.code;
        const outcome = handle({ ...state, selection: each.command === "pageBreak" ? caret([0], 2) : state.selection }, { type: "key", key, mod: chord.mod, shift: chord.shift, alt: chord.alt });
        expect({ keys: each.keys, handled: outcome !== null }).toEqual({ keys: each.keys, handled: true });
    }
});

test("every menu line whose command has a shortcut shows the table's keys as its hint", () => {
    const commands = [...new Set(SHORTCUTS.flatMap((each) => (each.command ? [each.command] : [])))];
    const act: RowActions = Object.fromEntries(commands.map((command) => [command, () => {}]));
    const lines = headings({ rich: true, outline: false, markdown: false, words: 0 }, act).flatMap((heading) => heading.items());
    for (const command of commands) {
        const line = lines.find((each) => each.run === act[command]);
        expect({ command, shown: !!line }).toEqual({ command, shown: true });
        expect({ command, hint: line?.hint }).toEqual({ command, hint: keysFor(command) });
    }
});

test("the panel's search finds a shortcut by its words, its keys or its menu", () => {
    expect(findShortcuts("bullet").map((each) => each.keys)).toContain("Ctrl+Shift+8");
    expect(findShortcuts("ctrl+shift+7").map((each) => each.label)).toContain("Numbered list");
    expect(findShortcuts("").length).toBe(SHORTCUTS.length);
});
