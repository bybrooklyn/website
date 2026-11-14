// The shortcut table is held to being one table: no two shortcuts share keys, every menu line with a
// shortcut shows the table's keys, a shortcut the surface keeps is one keys.ts really handles, and
// the keys are read the same from a key press as from the table. That every other shortcut runs its
// command when pressed is held in editor.test.ts, in a browser.

import { expect, test } from "bun:test";
import { documentOf, paragraph } from "./document";
import { caret, handle } from "./keys";
import { headings, type Command, type RowActions } from "./menus";
import { chordFrom, chordOf, findShortcuts, keysFor, SHORTCUTS, shortcutFor, typing } from "./shortcuts";
import { altGraph } from "./surface";
import { everyLine } from "../core/ui";

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
    const lines = headings({ rich: true, outline: false, markdown: false }, act).flatMap((heading) => everyLine(heading.items()).map((each) => each.item));
    // the palette and the zoom's lines (paper.ts) show their own keys, from the same table
    for (const command of commands.filter((each) => !["palette", "find", "zoomIn", "zoomOut", "zoomReset"].includes(each))) {
        const line = lines.find((each) => each.run === act[command]);
        expect({ command, shown: !!line }).toEqual({ command, shown: true });
        expect({ command, hint: line?.hint }).toEqual({ command, hint: keysFor(command) });
    }
});

test("the panel's search finds a shortcut by its words, its keys or its menu", () => {
    expect(findShortcuts("bullet").map((each) => each.keys)).toContain("Ctrl+Shift+8");
    expect(findShortcuts("ctrl+shift+7").map((each) => each.label)).toContain("Numbered list");
    // one shortcut is shown for each command, the one its menu line shows
    expect(findShortcuts("").map((each) => each.keys)).not.toContain("Ctrl+Y");
    expect(findShortcuts("strike").map((each) => each.keys)).toEqual(["Alt+Shift+5"]);
});

test("a shortcut is matched by the letter its key types on US, AZERTY, German, Spanish and Dvorak layouts, and AltGr or a Mac's Alt typing a character is never one", () => {
    const press = (code: string, key: string, held: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; altGraph?: boolean } = {}) => ({
        code,
        key,
        ctrlKey: !!held.ctrl,
        metaKey: !!held.meta,
        shiftKey: !!held.shift,
        altKey: !!held.alt,
        getModifierState: (name: string) => name === "AltGraph" && !!held.altGraph,
    });
    const command = (event: ReturnType<typeof press>, mac = false) => shortcutFor(chordFrom(event, mac))?.command;
    // bold is the key that types b, wherever it is
    expect(command(press("KeyB", "b", { ctrl: true }))).toBe("bold"); // US
    expect(command(press("KeyN", "b", { ctrl: true }))).toBe("bold"); // Dvorak: b is on the N key
    expect(command(press("KeyB", "x", { ctrl: true }))).not.toBe("bold"); // Dvorak: the B key types x
    expect(command(press("KeyQ", "a", { ctrl: true }))).toBe(command(press("KeyA", "a", { ctrl: true }))); // AZERTY: a is on the Q key
    expect(command(press("KeyZ", "y", { ctrl: true }))).toBe(command(press("KeyY", "y", { ctrl: true }))); // German: y and z swap
    // on a layout with no Latin letters the key's place is used
    expect(command(press("KeyB", "и", { ctrl: true }))).toBe("bold");
    // a digit with Shift or Alt is the key's place in the digit row
    expect(command(press("Digit8", "*", { ctrl: true, shift: true }))).toBe("bullet"); // US: Shift+8 types *
    expect(command(press("Digit8", "8", { ctrl: true, shift: true }))).toBe("bullet"); // AZERTY: Shift+8 types 8
    expect(command(press("Digit1", "1", { ctrl: true, alt: true }))).toBe("heading1");
    // and agrees with the surface's own rule (altGraph) for every press here
    for (const [code, key] of [["Digit1", "&"], ["Digit2", "@"], ["KeyB", "b"], ["KeyE", "€"]] as const) expect(typing(press(code, key, { ctrl: true, alt: true }))).toBe(altGraph(press(code, key, { ctrl: true, alt: true }), false));
    // AltGr typing a character: Windows reports it as Ctrl+Alt, or the browser says AltGraph
    expect(command(press("Digit2", "@", { ctrl: true, alt: true }))).toBeUndefined(); // Spanish AltGr+2
    expect(command(press("Digit0", "@", { ctrl: true, alt: true }))).toBeUndefined(); // AZERTY AltGr+0
    expect(command(press("KeyQ", "@", { ctrl: true, alt: true }))).toBeUndefined(); // German AltGr+Q
    expect(command(press("KeyE", "€", { ctrl: true, alt: true }))).toBeUndefined(); // German AltGr+E
    expect(command(press("KeyF", "f", { ctrl: true, alt: true, altGraph: true }))).toBeUndefined();
    expect(command(press("KeyF", "f", { ctrl: true, alt: true }))).toBe("footnote");
    // on a Mac, Alt+Shift+digit and Alt+/ that type a character are typing
    expect(command(press("Digit5", "ﬁ", { alt: true, shift: true }), true)).toBeUndefined();
    expect(command(press("Slash", "÷", { alt: true }), true)).toBeUndefined();
    expect(command(press("Slash", "/", { alt: true }))).toBe("palette");
    expect(command(press("Digit5", "%", { alt: true, shift: true }))).toBe("strike");
});
