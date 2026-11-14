// Every keyboard shortcut mdQuire has, in one table: the keys, the command they run, and the menu it
// lives in. The editor's key handler runs commands from it, each menu line shows its keys as its hint
// from it, and the Ctrl+/ panel lists it, so the three cannot disagree. The keys follow Google
// Docs' wherever the browser lets a page have them; Ctrl is Cmd on a Mac.
//
// Some shortcuts are the editing surface's own (keys.ts handles them as it handles typing: bold,
// undo, the heading levels): those are marked `surface`, and the editor leaves them to it. Some
// are kept by another piece (dictation's Ctrl+D) or are keys in the text rather than commands (Tab
// in a list): those have no command and are listed for the panel only.

import type { Command } from "./menus";

/** One shortcut. `keys` is written as words, "Ctrl+Shift+8"; `menu` is where the panel groups it. */
export interface Shortcut {
    keys: string;
    label: string;
    menu: "File" | "Edit" | "View" | "Insert" | "Format" | "Tools" | "Help" | "In the text";
    command?: Command;
    /** Handled by the editing surface (keys.ts), which sees it first. */
    surface?: boolean;
    /** The browser's own key (cut, copy, paste), which the surface takes as the browser sends it: listed and shown, never run by the editor. */
    browser?: boolean;
}

/** Every shortcut, in the order the panel shows them. The first for a command is the one its menu line shows. */
export const SHORTCUTS: Shortcut[] = [
    { keys: "Ctrl+P", label: "Print", menu: "File", command: "print" },
    { keys: "Ctrl+Z", label: "Undo", menu: "Edit", command: "undo", surface: true },
    { keys: "Ctrl+Shift+Z", label: "Redo", menu: "Edit", command: "redo", surface: true },
    { keys: "Ctrl+Y", label: "Redo", menu: "Edit", command: "redo", surface: true },
    { keys: "Ctrl+X", label: "Cut", menu: "Edit", command: "cut", browser: true },
    { keys: "Ctrl+C", label: "Copy", menu: "Edit", command: "copy", browser: true },
    { keys: "Ctrl+V", label: "Paste", menu: "Edit", command: "paste", browser: true },
    { keys: "Delete", label: "Delete", menu: "Edit", command: "delete", surface: true },
    { keys: "Ctrl+A", label: "Select all", menu: "Edit", command: "selectAll" },
    { keys: "Ctrl+Shift+V", label: "Paste without formatting", menu: "Edit", command: "pastePlain" },
    { keys: "Ctrl+F", label: "Find", menu: "Edit", command: "find" },
    { keys: "Ctrl+H", label: "Find and replace", menu: "Edit", command: "replace" },
    { keys: "Ctrl+K", label: "Link", menu: "Insert", command: "link", surface: true },
    { keys: "Ctrl+Shift+F", label: "Full screen", menu: "View", command: "fullScreen" },
    { keys: "Ctrl+=", label: "Zoom in", menu: "View", command: "zoomIn" },
    { keys: "Ctrl+-", label: "Zoom out", menu: "View", command: "zoomOut" },
    { keys: "Ctrl+0", label: "Zoom to 100%", menu: "View", command: "zoomReset" },
    { keys: "Ctrl+Enter", label: "Page break", menu: "Insert", command: "pageBreak", surface: true },
    { keys: "Ctrl+Alt+F", label: "Footnote", menu: "Insert", command: "footnote" },
    { keys: "Ctrl+;", label: "Emoji", menu: "Insert", command: "emoji" },
    { keys: "Ctrl+Alt+M", label: "Comment", menu: "Insert", command: "comment" },
    { keys: "Ctrl+B", label: "Bold", menu: "Format", command: "bold", surface: true },
    { keys: "Ctrl+I", label: "Italic", menu: "Format", command: "italic", surface: true },
    { keys: "Ctrl+U", label: "Underline", menu: "Format", command: "underline", surface: true },
    { keys: "Alt+Shift+5", label: "Strikethrough", menu: "Format", command: "strike" },
    { keys: "Ctrl+Shift+X", label: "Strikethrough", menu: "Format", command: "strike", surface: true },
    { keys: "Ctrl+E", label: "Inline code", menu: "Format", command: "inline", surface: true },
    { keys: "Ctrl+Shift+H", label: "Marked", menu: "Format", command: "marked", surface: true },
    { keys: "Ctrl+.", label: "Superscript", menu: "Format", command: "superscript", surface: true },
    { keys: "Ctrl+,", label: "Subscript", menu: "Format", command: "subscript", surface: true },
    { keys: "Ctrl+Alt+0", label: "Normal text", menu: "Format", command: "paragraph", surface: true },
    { keys: "Ctrl+Alt+1", label: "Heading 1", menu: "Format", command: "heading1", surface: true },
    { keys: "Ctrl+Alt+2", label: "Heading 2", menu: "Format", command: "heading2", surface: true },
    { keys: "Ctrl+Alt+3", label: "Heading 3", menu: "Format", command: "heading3", surface: true },
    { keys: "Ctrl+Alt+4", label: "Heading 4", menu: "Format", command: "heading4", surface: true },
    { keys: "Ctrl+Alt+5", label: "Heading 5", menu: "Format", command: "heading5", surface: true },
    { keys: "Ctrl+Alt+6", label: "Heading 6", menu: "Format", command: "heading6", surface: true },
    { keys: "Ctrl+Shift+7", label: "Numbered list", menu: "Format", command: "number" },
    { keys: "Ctrl+Shift+8", label: "Bulleted list", menu: "Format", command: "bullet" },
    { keys: "Ctrl+Shift+9", label: "Checklist", menu: "Format", command: "task" },
    { keys: "Ctrl+]", label: "Increase indent", menu: "Format", command: "indent" },
    { keys: "Ctrl+[", label: "Decrease indent", menu: "Format", command: "outdent" },
    { keys: "Ctrl+Shift+L", label: "Align left", menu: "Format", command: "left" },
    { keys: "Ctrl+Shift+E", label: "Center", menu: "Format", command: "center" },
    { keys: "Ctrl+Shift+R", label: "Align right", menu: "Format", command: "right" },
    { keys: "Ctrl+Shift+J", label: "Justify", menu: "Format", command: "justify" },
    { keys: "Ctrl+Shift+.", label: "Increase font size", menu: "Format", command: "bigger" },
    { keys: "Ctrl+Shift+,", label: "Decrease font size", menu: "Format", command: "smaller" },
    { keys: "Ctrl+\\", label: "Clear formatting", menu: "Format", command: "clear" },
    { keys: "Ctrl+Shift+C", label: "Word count", menu: "Tools", command: "wordCount" },
    { keys: "Ctrl+/", label: "Keyboard shortcuts", menu: "Help", command: "shortcuts" },
    { keys: "Alt+/", label: "Commands", menu: "Tools", command: "palette" },
    { keys: "Ctrl, Ctrl", label: "Commands: tap Ctrl twice, or press the button in the bottom left corner", menu: "Tools" },
    { keys: "Ctrl+D", label: "Dictation, start or stop", menu: "Tools" },
    { keys: "Tab", label: "In a list, put the item one level in, with what is under it", menu: "In the text" },
    { keys: "Shift+Tab", label: "In a list, bring the item one level out", menu: "In the text" },
    { keys: "Enter", label: "On an empty list item, one level out; at the top, out of the list", menu: "In the text" },
    { keys: "Backspace", label: "At the start of an item, take its bullet away; again, join it to the line above", menu: "In the text" },
    { keys: "/", label: "On an empty line, the things that can be put in there", menu: "In the text" },
    { keys: "Shift+Enter", label: "A new line in the same paragraph", menu: "In the text" },
    { keys: "Ctrl+Backspace", label: "Delete the word before", menu: "In the text" },
    { keys: "Tab", label: "In a table, the next cell; after the last, a new row", menu: "In the text" },
    { keys: "Alt+Enter", label: "With the cursor in a link, open it, or go to the heading it names", menu: "In the text" },
];

/** A shortcut as the keyboard sends it: which modifiers and which key, by its place on the keyboard. */
export interface Chord {
    mod: boolean;
    shift: boolean;
    alt: boolean;
    code: string;
}

/** The key places the table's keys name, for keys whose character changes with Shift. */
const CODES: Record<string, string> = { "=": "Equal", "-": "Minus", ".": "Period", ",": "Comma", ";": "Semicolon", "/": "Slash", "\\": "Backslash", "[": "BracketLeft", "]": "BracketRight", Enter: "Enter", Tab: "Tab", Backspace: "Backspace" };

/** The chord a shortcut's keys stand for. */
export function chordOf(keys: string): Chord {
    const parts = keys.split("+");
    // "Ctrl++" would split into an empty last part; no shortcut here uses the plus key
    const key = parts[parts.length - 1]!;
    const held = parts.slice(0, -1);
    const code = CODES[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : /^\d$/.test(key) ? `Digit${key}` : key);
    return { mod: held.includes("Ctrl"), shift: held.includes("Shift"), alt: held.includes("Alt"), code };
}

/** A key press as the shortcut table reads it. */
export interface Press {
    code: string;
    key?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    getModifierState?: (key: string) => boolean;
}

/**
 * True if a key press is typing a character, never a shortcut, by the same rule as the surface's
 * altGraph (surface.ts): AltGr, or on Windows and Linux Ctrl and Alt held together typing something
 * that is not a plain letter or digit (@, #, {, [, | and € on many layouts). On a Mac, Alt without
 * Cmd or Ctrl types a character too, so Alt+Shift+digit and Alt+/ that type one are typing.
 */
export function typing(event: Press, mac = false): boolean {
    const key = event.key ?? "";
    if (event.getModifierState?.("AltGraph")) return true;
    if (!mac && event.ctrlKey && event.altKey && !event.metaKey && [...key].length === 1 && !/^[a-z0-9]$/i.test(key)) return true;
    return mac && event.altKey && !event.metaKey && !event.ctrlKey && [...key].length === 1 && /^(Digit\d|Slash)$/.test(event.code) && !/^[0-9/]$/.test(key);
}

/**
 * The chord a key press makes; Ctrl is Cmd on a Mac. As the surface matches its own keys
 * (surface.ts, shortcutKey): a letter is the letter the key types, so Ctrl+B is bold where the key
 * that types b is (Dvorak, AZERTY), and on a layout with no Latin letters the letter of the key's
 * place; a digit is the key's place in the digit row when the key types something else (Shift on
 * AZERTY, Shift on US); any other key is known by its character, or its place. A press that is
 * typing (see `typing`) makes a chord that is no shortcut.
 */
export function chordFrom(event: Press, mac = false): Chord {
    const key = event.key ?? "";
    const held = { mod: mac ? event.metaKey : event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    if (typing(event, mac)) return { ...held, code: "" };
    let code: string;
    if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
    else if (/^Key[A-Z]$/.test(event.code) && !/^[ -~]$/.test(key)) code = event.code;
    else if (/^\d$/.test(key)) code = `Digit${key}`;
    else if (/^Digit\d$/.test(event.code)) code = event.code;
    // a key with no place given (some on-screen keyboards, a key sent by a script) is known by its character
    else code = CODES[key] ?? (event.code || key);
    return { ...held, code };
}

const same = (a: Chord, b: Chord) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.code === b.code;

/** The shortcut a chord is, if it is one with a command. */
export function shortcutFor(chord: Chord): Shortcut | undefined {
    return SHORTCUTS.find((each) => each.command && same(chordOf(each.keys), chord));
}

/** The keys a command's menu line shows, the first in the table for it. */
export function keysFor(command: Command): string | undefined {
    return SHORTCUTS.find((each) => each.command === command)?.keys;
}

/** Every shortcut but a command's second keys (Ctrl+Y for redo): one is shown for each command, the one its menu line shows, though both work. */
const SHOWN = SHORTCUTS.filter((each, index) => !each.command || SHORTCUTS.findIndex((other) => other.command === each.command) === index);

/** The shortcuts whose keys or words have what was typed, for the panel's search. */
export function findShortcuts(query: string): Shortcut[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return SHOWN;
    return SHOWN.filter((each) => each.label.toLowerCase().includes(wanted) || each.keys.toLowerCase().includes(wanted) || each.menu.toLowerCase().includes(wanted));
}
