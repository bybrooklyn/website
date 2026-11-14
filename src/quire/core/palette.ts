// The command palette: one list of what a kind of document can do. Two quick taps of Ctrl (on a
// Mac, of Cmd or of Ctrl), Alt+/, or the quiet button in the window's bottom left corner grow it up
// out of that corner as a search field over a short list: what fits where the cursor is (the kind
// says what, as mdQuire gives a table's controls or a picked picture's menu), then what the writer
// uses most. Typing looks through every command by its name, its other words and its menu, and
// through what the kind offers only to a search (mdQuire's headings, to go to one).
//
// No command is listed here. The lines are the kind's menus' own (menu-row.ts), each with its
// shortcut, so a command added to a kind's menus is in its palette too. mdQuire's slash menu, the
// same list at the caret, is its own (md/slash-menu.ts).
//
// The double tap, how well a line answers what was typed and the order of the lines are pure and
// tested; the rest is DOM.

import type { Heading } from "./menu-row";
import { PICKED, counted, remember, remembered, type Counts } from "./most-used";
import { control, everyLine, flowMenu, icon, keySymbols, make, menuLine, type MenuItem } from "./ui";

/** One line of the palette: a menu line with what it is known by. `fits` is the place it belongs to (the kind names its places); `heading` is a heading's words, for a line that goes to it. */
export interface Line extends MenuItem {
    key: string;
    menu?: string;
    words?: string[];
    fits?: string;
    heading?: string;
}

/** What a kind adds to a command's line: more words it is found by, an icon where the menu has none, and the place it fits. */
export interface Described {
    icon?: string;
    words?: string[];
    fits?: string;
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

/**
 * The lines for what was typed, the best answers first, and among answers as good the ones that fit
 * where the cursor is, then the most used, then the menus' order. With nothing typed: what fits,
 * then the most used, then the kind's `first` (mdQuire's are the slash menu's first five), and no headings. At most `few` of them.
 */
export function rank(lines: Line[], query: string, place: string | undefined, counts: Counts, few = 8, first: string[] = []): Line[] {
    const typed = query.trim() !== "";
    const fit = (line: Line) => (place && line.fits === place ? 1 : 0);
    const early = (line: Line) => (typed || !first.includes(line.key) ? first.length : first.indexOf(line.key));
    return lines
        .map((line, index) => ({ line, index, score: typed ? score(line, query) : line.heading === undefined ? 1 : 0 }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || fit(b.line) - fit(a.line) || (counts[b.line.key] ?? 0) - (counts[a.line.key] ?? 0) || early(a.line) - early(b.line) || a.index - b.index)
        .slice(0, few)
        .map((each) => each.line);
}

/**
 * Every line of the menus once, the lines of the menus beside their lines opened out, each with the
 * menus it is in ("Format › Text"), its other names and what the kind adds by `describe` (more words,
 * an icon where the line has none, where it fits), and its shortcut when its hint is one. A line that opens a form
 * beside it is run by `reveal`, which opens the menus down to it.
 */
export function commandLines(menus: Heading[], reveal?: (path: string[]) => void, describe: (key: string) => Described = () => ({})): Line[] {
    const seen = new Set<string>();
    return menus.flatMap((heading) =>
        everyLine(heading.items(), [heading.label]).flatMap(({ item, within }) => {
            const menu = within.join(" › ");
            const key = item.key ?? `${menu}: ${item.label}`;
            if (item.disabled || seen.has(key)) return [];
            seen.add(key);
            const more = describe(key);
            const run = item.form && reveal ? () => reveal([...within, item.label]) : item.run;
            return [{ icon: more.icon, ...item, run, items: undefined, form: undefined, key, menu, words: [...(item.words ?? []), ...(more.words ?? [])], fits: more.fits, hint: item.hint && keySymbols(item.hint).words ? item.hint : undefined }];
        }),
    );
}

/** What the palette is given by the kind of document it serves. */
export interface PaletteOptions {
    /** The element the writing is in: the palette opens only from there (or from nowhere) and gives the keyboard back to it. */
    writing: () => HTMLElement;
    /** The menus as they stand. */
    menus?: () => Heading[];
    /** Opens the menus down to a line whose form opens beside it (menu-row.ts, reveal). */
    reveal?: (path: string[]) => void;
    /** As it opens: the lines that fit where the cursor is, ranked first, and the name of that place. */
    here?: () => { lines: Line[]; place?: string };
    /** Lines found only by typing, such as the headings to go to. */
    found?: () => Line[];
    /** More words, an icon and a place for a command's line. */
    describe?: (key: string) => Described;
    /** The commands it opens on before anything has been counted, after what fits. */
    first?: string[];
    /** What the kind counts as used, beside what was picked from the palette. */
    counts?: () => Counts;
    /** Remembers where the writer was as it opens, and goes back there when it closes. */
    keep?: () => void;
    back?: () => void;
    /** Where the button rests: the editor's element, so that it goes when the editor does. */
    corner?: HTMLElement;
}

/** True on a Mac, where Cmd taps as Ctrl does. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Builds the palette: its button, its double tap, and its list. */
export function createPalette(options: PaletteOptions): { open(): void; close(): void; destroy(): void } {
    /** Whether it is open. */
    let mode: "corner" | undefined;
    let active = 0;
    /** The corner's lines: those shown, and all there are to search. */
    let shown: Line[] = [];
    let all: Line[] = [];
    let place: string | undefined;
    /** Where the keyboard was, to go back to. */
    let came: Element | null = null;

    const menu = flowMenu("Commands", {
        className: "quire-palette",
        onClose: () => {
            const was = mode;
            mode = undefined;
            if (was === "corner") back();
        },
    });
    const button = control(MAC ? "Commands (tap ⌘ twice)" : "Commands (tap Ctrl twice)", icon("command"), () => (mode === "corner" ? menu.close(false) : openCorner()), "quire-button quire-palette-button");
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

    /** Back to the writing where it was: what had the keyboard in it (a picked picture), or where the kind says. */
    function back() {
        const writing = options.writing();
        if (came instanceof HTMLElement && came !== writing && writing.contains(came)) return came.focus({ preventScroll: true });
        options.back?.();
    }

    /** What was picked from the palette, and what the kind counts besides. */
    const counts = (): Counts => {
        const both = { ...remembered(undefined, PICKED) };
        for (const [key, count] of Object.entries(options.counts?.() ?? {})) both[key] = (both[key] ?? 0) + count;
        return both;
    };

    function openCorner() {
        came = document.activeElement;
        options.keep?.();
        const here = options.here?.() ?? { lines: [] };
        place = here.place;
        all = [...here.lines, ...commandLines(options.menus?.() ?? [], options.reveal, options.describe)];
        mode = "corner";
        field.value = "";
        show();
        menu.open(button, form);
        field.focus({ preventScroll: true });
    }

    /** The corner's lines for what is typed in its field. */
    function show() {
        const query = field.value;
        shown = rank(query.trim() ? [...all, ...(options.found?.() ?? [])] : all, query, place, counts(), query.trim() ? 8 : 7, options.first);
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
        list.querySelectorAll<HTMLElement>(".quire-menu-line").forEach((row, index) => {
            row.classList.toggle("active", index === active);
            row.setAttribute("aria-selected", String(index === active));
            if (index === active) field.setAttribute("aria-activedescendant", row.id);
        });
    }

    /** Its keys: the arrows move, Enter chooses, Escape closes. */
    function steer(event: KeyboardEvent, count: number, choose: () => void) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (count) active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            mark();
        } else if (event.key === "Enter") choose();
        else if (event.key === "Escape") menu.close(false);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    field.addEventListener("input", show);
    field.addEventListener("keydown", (event) => {
        if (!event.isComposing) steer(event, shown.length, () => shown[active] && run(shown[active]!));
    });

    // ---- the double tap ----
    let taps: Taps = {};
    const keys = MAC ? ["Control", "Meta"] : ["Control"];
    /** Opens it only from the writing (or from nowhere), never over a field, a menu or a dialog; in it, the double tap closes it. */
    const allowed = () => {
        const at = document.activeElement;
        return button.isConnected && button.checkVisibility() && (!at || at === document.body || options.writing().contains(at));
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
            for (const each of [button, menu.box]) each.remove();
        },
    };
}
