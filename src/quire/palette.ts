// The command palette: one list of what mdQuire can do, with two ways in. Two quick taps of Ctrl
// (on a Mac, of Cmd or of Ctrl) or the quiet button in the window's bottom left corner grow it up
// out of that corner as a search field over a short list: what fits where the cursor is (a table's
// controls, a picked picture's menu, the formatting for selected words, a list's commands), then
// what the writer uses most. Typing looks through every command by its name, its other words and
// its menu, and through the headings, to go to one. A slash typed on an empty line opens the same
// list at the cursor with the things that can be put in there (slash.ts), narrowed by what is typed
// after the slash.
//
// No command is listed here. The lines are the menus' own (menu-row.ts, each with its shortcut from
// shortcuts.ts), with the slash items' words to be found by (slash.ts), and a table's controls and a
// picture's menu while they are there; a command added to any of those is in the palette too.
//
// The double tap, how well a line answers what was typed and the order of the lines are pure and
// tested; the rest is DOM.

import { blockAt, outline, type Document, type Selection } from "./document";
import { caret, collapsed } from "./keys";
import type { Heading } from "./menu-row";
import { counted, FIRST_FIVE, made, PICKED, remember, remembered, type Counts } from "./most-used";
import { chooseSlash, filterSlash, SLASH_ITEMS, SLASH_KEYS, slashQuery, type SlashItem } from "./slash";
import type { Surface } from "./surface";
import { tableAt } from "./tables";
import { control, everyLine, flowMenu, icon, keySymbols, make, markActive, menuLine, still, unmarkActive, type MenuItem } from "./ui";

/** Where the cursor is, as far as the palette ranks by it. */
export type Place = "table" | "picture" | "words" | "list";

/** One line of the palette: a menu line with what it is known by. `fits` is the place it belongs to; `heading` is a heading's words, for a line that goes to it. */
export interface Line extends MenuItem {
    key: string;
    menu?: string;
    words?: string[];
    fits?: Place;
    heading?: string;
}

/** How quick a double tap is: each press of the key, and the wait from one release to the next press, within this many milliseconds. */
export const TAP = 350;

/** A key going down or up, or anything else (a press of the pointer, the wheel, the window left), as the double tap reads it. `held` is any other modifier held with the key, AltGr among them. */
export interface Stroke {
    type: "down" | "up" | "other";
    key?: string;
    time: number;
    repeat?: boolean;
    held?: boolean;
    composing?: boolean;
}

/** What the double tap remembers between strokes: the key, when it went down, and when the first tap was let go. */
export interface Taps {
    key?: string;
    down?: number;
    up?: number;
}

/**
 * The double tap: a press and release of one of `keys` alone, twice, quickly. Any other key pressed
 * between (Ctrl+C), another modifier held (AltGr, which Windows sends as Ctrl and Alt), a press held
 * longer than a tap, a click or a turn of the wheel with it held, or typing with an input method,
 * starts it over. Gives the new memory, and whether the second tap has just ended.
 */
export function tap(taps: Taps, stroke: Stroke, keys: string[] = ["Control"]): { taps: Taps; open: boolean } {
    const ours = stroke.key !== undefined && keys.includes(stroke.key) && !stroke.held && !stroke.composing;
    if (stroke.type === "down") {
        if (!ours || stroke.repeat) return { taps: {}, open: false };
        const first = taps.key === stroke.key && taps.up !== undefined && stroke.time - taps.up <= TAP ? taps.up : undefined;
        return { taps: { key: stroke.key, down: stroke.time, up: first }, open: false };
    }
    if (stroke.type === "up" && stroke.key === taps.key) {
        if (!ours || taps.down === undefined || stroke.time - taps.down > TAP) return { taps: {}, open: false };
        return taps.up !== undefined ? { taps: {}, open: true } : { taps: { key: taps.key, up: stroke.time }, open: false };
    }
    // another key let go changes nothing; anything else starts over
    return { taps: stroke.type === "up" ? taps : {}, open: false };
}

/** Where the cursor is: on a picked picture, in a table, over selected words, or in a list. */
export function placeOf(doc: Document, selection: Selection, picked = false): Place | undefined {
    const path = selection.focus.path;
    if (picked) return "picture";
    if (tableAt(doc, path)) return "table";
    if (!collapsed(selection)) return "words";
    if (path.some((_, depth) => blockAt(doc, path.slice(0, depth + 1))?.kind === "list")) return "list";
    return undefined;
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a line answers what was typed: 4 when its name starts with it, 3 when each typed word
 * starts a word of the name, 2 when each starts a word of the name, its other words or its menu, 1
 * when the name holds it anywhere, and 0 when it does not answer at all. A heading's line is known
 * by the heading's words alone.
 */
export function score(line: Pick<Line, "label" | "words" | "menu" | "heading">, query: string): number {
    const typed = query.trim().toLowerCase();
    const wanted = wordsOf(typed);
    if (!wanted.length) return 0;
    const name = (line.heading ?? line.label).toLowerCase();
    const every = (words: string[]) => wanted.every((want) => words.some((word) => word.startsWith(want)));
    if (name.startsWith(typed)) return 4;
    if (every(wordsOf(name))) return 3;
    if (every([...wordsOf(name), ...(line.words ?? []).flatMap(wordsOf), ...wordsOf(line.menu ?? "")])) return 2;
    return name.includes(typed) ? 1 : 0;
}

/** The slash items whose command in the menus has another name. */
const SAME: Record<string, string> = { image: "picture", pagebreak: "pageBreak" };

/** The menus' name for what a slash item makes. */
function commandOf(slashKey: string): string {
    return SAME[slashKey] ?? slashKey;
}

/** The commands the palette opens on before anything has been counted, after what fits: the slash menu's first five. */
const FIRST = FIRST_FIVE.map((key) => commandOf(key));

/**
 * The lines for what was typed, the best answers first, and among answers as good the ones that fit
 * where the cursor is, then the most used, then the menus' order. With nothing typed: what fits,
 * then the most used, then the first five, and no headings. At most `few` of them.
 */
export function rank(lines: Line[], query: string, place: Place | undefined, counts: Counts, few = 8): Line[] {
    const typed = query.trim() !== "";
    const fit = (line: Line) => (place && line.fits === place ? 1 : 0);
    const first = (line: Line) => (typed || !FIRST.includes(line.key) ? FIRST.length : FIRST.indexOf(line.key));
    return lines
        .map((line, index) => ({ line, index, score: typed ? score(line, query) : line.heading === undefined ? 1 : 0 }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || fit(b.line) - fit(a.line) || (counts[b.line.key] ?? 0) - (counts[a.line.key] ?? 0) || first(a.line) - first(b.line) || a.index - b.index)
        .slice(0, few)
        .map((each) => each.line);
}

/** The commands that act on selected words, and those that act on a list, ranked first there. */
const FITS: Record<string, Place> = Object.fromEntries([
    ...["bold", "italic", "underline", "strike", "inline", "marked", "spoiler", "superscript", "subscript", "link", "clear", "color", "highlight", "size", "bigger", "smaller", "font", "comment"].map((key) => [key, "words"]),
    ...["bullet", "number", "task", "indent", "outdent"].map((key) => [key, "list"]),
]);

/**
 * Every line of the menus once, the lines of the menus beside their lines opened out, each with the
 * menus it is in ("Format › Text"), its other names and the slash item's words (and its icon, where
 * the line has none), where it fits, and its shortcut when its hint is one. A line that opens a form
 * beside it is run by `reveal`, which opens the menus down to it.
 */
export function commandLines(menus: Heading[], reveal?: (path: string[]) => void): Line[] {
    const seen = new Set<string>();
    return menus.flatMap((heading) =>
        everyLine(heading.items(), [heading.label]).flatMap(({ item, within }) => {
            const menu = within.join(" › ");
            const key = item.key ?? `${menu}: ${item.label}`;
            if (item.disabled || seen.has(key)) return [];
            seen.add(key);
            const slash = SLASH_ITEMS.find((each) => commandOf(each.key) === key);
            const run = item.form && reveal ? () => reveal([...within, item.label]) : item.run;
            return [{ icon: slash?.icon, ...item, run, items: undefined, form: undefined, key, menu, words: [...(item.words ?? []), ...(slash?.words ?? [])], fits: FITS[key], hint: item.hint && keySymbols(item.hint).words ? item.hint : undefined }];
        }),
    );
}

/** A line to go to each heading that has words. */
export function headingLines(doc: Document, go: (path: number[]) => void): Line[] {
    return outline(doc)
        .filter((entry) => entry.text)
        .map((entry) => ({ key: `heading ${entry.path.join(".")}`, label: `Go to: ${entry.text}`, heading: entry.text, icon: "heading", run: () => go(entry.path) }));
}

/** What the palette is given by the editor. Each is optional, so that the slash way in can be tried alone. */
export interface PaletteOptions {
    /** The menus as they stand. */
    menus?: () => Heading[];
    /** Opens the menus down to a line whose form opens beside it (menu-row.ts, reveal). */
    reveal?: (path: string[]) => void;
    /** A table's controls, while the cursor is in one. */
    table?: () => MenuItem[];
    /** The picked picture's menu, while one is picked. */
    picture?: () => MenuItem[];
    /** Asks for a picture to put where the slash was. */
    pickImage?: () => void;
    /** Where the button rests: the editor's element, so that it goes when the editor does. */
    corner?: HTMLElement;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Builds the palette for a surface: its button, its double tap, and the slash way in. */
export function createPalette(surface: Surface, options: PaletteOptions = {}): { open(): void; close(): void; destroy(): void } {
    // the slash way in grows from where the cursor is: a box the size of the cursor, never seen, is what it grows out of
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    /** How it was opened, while it is open. */
    let mode: "corner" | "slash" | undefined;
    let active = 0;
    /** The corner's lines: those shown, and all there are to search. */
    let shown: Line[] = [];
    let all: Line[] = [];
    let place: Place | undefined;
    /** The slash's items, and whether they show only the first five and More. */
    let items: SlashItem[] = [];
    let folded = false;
    const FOLD = 5;
    /** Where the writer was, to go back to. */
    let kept: Selection | undefined;
    let came: Element | null = null;

    const menu = flowMenu("Commands", {
        className: "quire-palette",
        onClose: () => {
            const was = mode;
            mode = undefined;
            unmarkActive(surface.element);
            if (was === "corner") back();
        },
    });
    const button = control(MAC ? "Commands (tap ⌘ twice)" : "Commands (tap Ctrl twice)", icon("search"), () => (mode === "corner" ? menu.close(false) : openCorner()), "quire-button quire-palette-button");
    options.corner?.append(button);

    const field = make("input", "quire-link-field quire-palette-field");
    field.type = "text";
    field.placeholder = "Search commands and headings";
    field.setAttribute("aria-label", "Search commands and headings");
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-expanded", "true");
    field.spellcheck = false;
    field.autocomplete = "off";
    const list = make("div", "quire-palette-list");
    list.setAttribute("role", "listbox");
    list.id = `quire-palette-${Math.random().toString(36).slice(2)}`;
    field.setAttribute("aria-controls", list.id);
    const form = make("div", "quire-palette-form");
    form.append(field, list);

    /** Back to the writing where it was: the picked picture, or the cursor. */
    function back() {
        if (came instanceof HTMLElement && came !== surface.element && surface.element.contains(came)) return came.focus({ preventScroll: true });
        if (kept) surface.setSelection(kept);
        surface.focus();
    }

    const counts = (): Counts => {
        const both = { ...remembered(undefined, PICKED) };
        for (const [key, count] of Object.entries(remembered(SLASH_KEYS))) both[commandOf(key)] = (both[commandOf(key)] ?? 0) + count;
        return both;
    };

    function openCorner() {
        came = document.activeElement;
        kept = surface.getSelection();
        const here = (lines: MenuItem[] | undefined, fits: Place, picture: string): Line[] => (lines ?? []).map((line) => ({ icon: picture, ...line, key: `${fits}: ${line.label}`, fits }));
        const picture = here(options.picture?.(), "picture", "image");
        place = placeOf(surface.getDocument(), kept, picture.length > 0);
        all = [...picture, ...here(options.table?.(), "table", "table"), ...commandLines(options.menus?.() ?? [], options.reveal)];
        mode = "corner";
        field.value = "";
        show();
        menu.open(button, form);
        field.focus({ preventScroll: true });
    }

    /** The corner's lines for what is typed in its field. */
    function show() {
        const query = field.value;
        const go = (path: number[]) => {
            surface.setSelection(caret(path, 0));
            surface.elementAt(path)?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "center" });
            surface.focus();
        };
        shown = rank(query.trim() ? [...all, ...headingLines(surface.getDocument(), go)] : all, query, place, counts(), query.trim() ? 8 : 7);
        active = 0;
        list.replaceChildren(
            ...shown.map((line) => {
                const row = menuLine(line, MAC);
                // a line from a menu inside another says quietly where it is
                if (line.menu?.includes("›")) row.querySelector(".quire-menu-label")?.after(make("span", "quire-palette-where", line.menu));
                row.setAttribute("role", "option");
                row.removeAttribute("aria-checked");
                row.id = `${list.id}-${list.childElementCount}-${Math.random().toString(36).slice(2, 6)}`;
                row.addEventListener("mousedown", (event) => event.preventDefault());
                row.addEventListener("click", () => run(line));
                return row;
            }),
        );
        if (!shown.length) list.append(make("p", "quire-menu-note", "Nothing by that name"));
        mark();
    }

    /** Runs a corner line, counted, with the writing given back first so that the command acts where the writer was. */
    function run(line: Line) {
        remember(counted(remembered(undefined, PICKED), [line.key]), PICKED);
        menu.close(false);
        line.run();
    }

    /** Lights the active line, and points the field or the text at it for a screen reader. */
    function mark() {
        if (mode === "slash") return markActive(menu, surface.element, active);
        list.querySelectorAll<HTMLElement>(".quire-menu-line").forEach((row, index) => {
            row.classList.toggle("active", index === active);
            row.setAttribute("aria-selected", String(index === active));
            if (index === active) field.setAttribute("aria-activedescendant", row.id);
        });
    }

    /** The keys both ways in share: the arrows move, Enter (and in the text Tab) chooses, Escape closes. */
    function steer(event: KeyboardEvent, count: number, choose: () => void) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (count) active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            mark();
        } else if (event.key === "Enter" || (event.key === "Tab" && mode === "slash")) choose();
        else if (event.key === "Escape") menu.close(false);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    field.addEventListener("input", show);
    field.addEventListener("keydown", (event) => {
        if (!event.isComposing) steer(event, shown.length, () => shown[active] && run(shown[active]!));
    });

    // ---- the slash way in ----
    const rows = () => (folded ? items.slice(0, FOLD) : items);
    const pick = (item: SlashItem) => {
        menu.close(false);
        surface.run((doc, selection) => chooseSlash({ doc, selection }, item));
        if (!item.action) options.pickImage?.();
        surface.focus();
    };
    /** More grows the list open to everything, the five staying where they are. */
    const unfold = () => {
        folded = false;
        menu.more(slashLines());
        mark();
        surface.focus();
    };
    function slashLines(): MenuItem[] {
        if (items.length === 0) return [{ label: "Nothing by that name", run: () => menu.close(false) }];
        const lines: MenuItem[] = rows().map((item) => ({ label: item.label, icon: item.icon, hint: item.key.startsWith("heading") ? `H${item.key.slice(-1)}` : undefined, run: () => pick(item) }));
        return folded ? [...lines, { label: "More", icon: "chevron", quiet: true, stays: true, run: unfold }] : lines;
    }
    function openSlash(rect: DOMRect | null) {
        if (rect) Object.assign(anchor.style, { left: `${rect.left}px`, top: `${rect.top}px`, height: `${Math.max(rect.height, 16)}px` });
        mode = "slash";
        menu.open(anchor, slashLines());
        mark();
    }
    const stops = [
        // whatever made something (the palette, the bar, a menu, a shortcut, a typed Markdown mark) is counted, here alone
        surface.on("change", ({ doc, before, kind }) => {
            if (!before || (kind !== "format" && kind !== "shortcut")) return;
            const keys = made(before, doc).filter((key) => SLASH_KEYS.includes(key));
            if (keys.length) remember(counted(remembered(SLASH_KEYS), keys));
        }),
        surface.on("slash", ({ rect }) => {
            items = filterSlash("", surface.getDocument().mdx, remembered(SLASH_KEYS));
            folded = items.length > FOLD;
            active = 0;
            openSlash(rect);
        }),
        // typing after the slash narrows the list; leaving the line or the slash closes it
        surface.on("change", ({ doc }) => {
            if (mode !== "slash") return;
            const { path, offset } = surface.getSelection().focus;
            const query = slashQuery(doc, path, offset);
            if (query === undefined) return menu.close(false);
            // typing looks through everything, and once it has the list stays open to everything
            if (query.trim()) folded = false;
            items = filterSlash(query, doc.mdx, remembered(SLASH_KEYS));
            active = Math.min(active, Math.max(0, slashLines().length - 1));
            openSlash(null);
        }),
        surface.on("select", ({ selection }) => {
            if (mode === "slash" && slashQuery(surface.getDocument(), selection.focus.path, selection.focus.offset) === undefined) menu.close(false);
        }),
    ];
    // while the slash's list is open its keys come before the editor's
    const slashKey = (event: KeyboardEvent) => {
        if (mode !== "slash" || event.isComposing) return;
        steer(event, items.length ? slashLines().length : 0, () => {
            const item = rows()[active];
            if (item) pick(item);
            else if (folded) unfold();
            else menu.close(false);
        });
    };
    surface.element.addEventListener("keydown", slashKey, true);
    // as the page scrolls, the cursor's place moves, and the list, tied to it, with it
    const follow = () => {
        if (mode !== "slash") return;
        const selection = getSelection();
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
        if (rect && (rect.width || rect.height)) Object.assign(anchor.style, { left: `${rect.left}px`, top: `${rect.top}px` });
    };
    addEventListener("scroll", follow, { passive: true });

    // ---- the double tap ----
    let taps: Taps = {};
    const keys = MAC ? ["Control", "Meta"] : ["Control"];
    /** Opens it only from the writing (or from nowhere), never over a field, a menu or a dialog; in it, the double tap closes it. */
    const allowed = () => {
        const at = document.activeElement;
        return button.isConnected && button.checkVisibility() && (!at || at === document.body || surface.element.contains(at));
    };
    const feel = (type: Stroke["type"]) => (event: Event) => {
        const stroke: Stroke =
            event instanceof KeyboardEvent
                ? { type, key: event.key, time: event.timeStamp, repeat: event.repeat, composing: event.isComposing || event.key === "Process", held: event.altKey || event.shiftKey || (event.key === "Meta" ? event.ctrlKey : event.metaKey) || event.getModifierState("AltGraph") }
                : { type: "other", time: event.timeStamp };
        const next = tap(taps, stroke, keys);
        taps = next.taps;
        if (!next.open) return;
        if (mode) menu.close(false);
        else if (allowed()) openCorner();
    };
    const listened: [string, (event: Event) => void][] = [
        ["keydown", feel("down")],
        ["keyup", feel("up")],
        ["pointerdown", feel("other")],
        ["wheel", feel("other")],
        ["blur", feel("other")],
    ];
    for (const [name, listener] of listened) addEventListener(name, listener, { capture: true, passive: true });

    return {
        /** Opens it from its corner, as Alt+/ does; open, its field takes the keyboard again. */
        open: () => (mode === "corner" ? field.focus({ preventScroll: true }) : openCorner()),
        close: () => menu.close(false),
        destroy() {
            menu.close(false);
            for (const [name, listener] of listened) removeEventListener(name, listener, { capture: true });
            for (const stop of stops) stop();
            surface.element.removeEventListener("keydown", slashKey, true);
            removeEventListener("scroll", follow);
            for (const each of [anchor, button, menu.box]) each.remove();
        },
    };
}
