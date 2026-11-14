// mdQuire's side of the command palette, and the slash menu. The palette is the core's
// (core/palette.ts); mdQuire tells it where the cursor is (on a picked picture, in a table, over
// selected words, in a list), gives it the lines that fit there and the headings to go to, the
// slash items' words for its commands, and the slash menu's first five to open on.
//
// The slash is the palette's second way in: a `/` typed at the start of an empty line opens the
// same kind of list at the caret, with the things that can be put in there (slash.ts), narrowed by
// what is typed after the slash. What is made is counted here, however it was made (made.ts).
//
//   const slash = createSlashMenu(surface, { pickImage });
//   createPalette({ ...paletteFor(surface, { table, picture }), menus, reveal, corner });

import { blockAt, outline, type Document, type Selection } from "./document";
import { caret, collapsed } from "./keys";
import { FIRST_FIVE, made } from "./made";
import { chooseSlash, filterSlash, SLASH_ITEMS, SLASH_KEYS, slashQuery, type SlashItem } from "./slash";
import type { Surface } from "./surface";
import { tableAt } from "./tables";
import { counted, remember, remembered, type Counts } from "../core/most-used";
import type { Described, Line, PaletteOptions } from "../core/palette";
import { flowMenu, make, markActive, still, unmarkActive, type MenuItem } from "../core/ui";

/** Where the cursor is, as far as the palette ranks by it. */
export type Place = "table" | "picture" | "words" | "list";

/** Where the cursor is: on a picked picture, in a table, over selected words, or in a list. */
export function placeOf(doc: Document, selection: Selection, picked = false): Place | undefined {
    const path = selection.focus.path;
    if (picked) return "picture";
    if (tableAt(doc, path)) return "table";
    if (!collapsed(selection)) return "words";
    if (path.some((_, depth) => blockAt(doc, path.slice(0, depth + 1))?.kind === "list")) return "list";
    return undefined;
}

/** The slash items whose command in the menus has another name. */
const SAME: Record<string, string> = { image: "picture", pagebreak: "pageBreak" };

/** The menus' name for what a slash item makes. */
function commandOf(slashKey: string): string {
    return SAME[slashKey] ?? slashKey;
}

/** The commands the palette opens on before anything has been counted, after what fits: the slash menu's first five. */
export const FIRST = FIRST_FIVE.map((key) => commandOf(key));

/** The commands that act on selected words, and those that act on a list, ranked first there. */
const FITS: Record<string, Place> = Object.fromEntries([
    ...["bold", "italic", "underline", "strike", "inline", "marked", "spoiler", "superscript", "subscript", "link", "clear", "color", "highlight", "size", "bigger", "smaller", "font", "comment"].map((key) => [key, "words"]),
    ...["bullet", "number", "task", "indent", "outdent"].map((key) => [key, "list"]),
]);

/** What mdQuire adds to a command's line in the palette: the slash item's words and icon, and where it fits. */
export function describe(key: string): Described {
    const slash = SLASH_ITEMS.find((each) => commandOf(each.key) === key);
    return { icon: slash?.icon, words: slash?.words, fits: FITS[key] };
}

/** A line to go to each heading that has words. */
export function headingLines(doc: Document, go: (path: number[]) => void): Line[] {
    return outline(doc)
        .filter((entry) => entry.text)
        .map((entry) => ({ key: `heading ${entry.path.join(".")}`, label: `Go to: ${entry.text}`, heading: entry.text, icon: "heading", run: () => go(entry.path) }));
}

/** What made, counted under the menus' names, for the palette to rank by beside what was picked from it. */
export function madeCounts(): Counts {
    const counts: Counts = {};
    for (const [key, count] of Object.entries(remembered(SLASH_KEYS))) counts[commandOf(key)] = (counts[commandOf(key)] ?? 0) + count;
    return counts;
}

/** What mdQuire gives the core's palette for a surface: where the cursor is and what fits there, the headings, the slash's words and first five, and the way back. */
export function paletteFor(surface: Surface, options: { table?: () => MenuItem[]; picture?: () => MenuItem[] } = {}): PaletteOptions {
    let kept: Selection | undefined;
    const go = (path: number[]) => {
        surface.setSelection(caret(path, 0));
        surface.elementAt(path)?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "center" });
        surface.focus();
    };
    return {
        writing: () => surface.element,
        keep: () => void (kept = surface.getSelection()),
        back: () => {
            if (kept) surface.setSelection(kept);
            surface.focus();
        },
        here: () => {
            const here = (lines: MenuItem[] | undefined, fits: Place, picture: string): Line[] => (lines ?? []).map((line) => ({ icon: picture, ...line, key: `${fits}: ${line.label}`, fits }));
            const picture = here(options.picture?.(), "picture", "image");
            return { lines: [...picture, ...here(options.table?.(), "table", "table")], place: placeOf(surface.getDocument(), kept ?? surface.getSelection(), picture.length > 0) };
        },
        found: () => headingLines(surface.getDocument(), go),
        describe,
        first: FIRST,
        counts: madeCounts,
    };
}

/** Builds the slash menu for a surface, and counts what each change made. */
export function createSlashMenu(surface: Surface, options: { pickImage?: () => void } = {}): { close(): void; destroy(): void } {
    // it grows from where the cursor is: a box the size of the cursor, never seen, is what it grows out of
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    let open = false;
    let active = 0;
    /** The slash's items, and whether they show only the first five and More. */
    let items: SlashItem[] = [];
    let folded = false;
    const FOLD = 5;
    const menu = flowMenu("Commands", {
        className: "quire-palette",
        onClose: () => {
            open = false;
            unmarkActive(surface.element);
        },
    });
    const mark = () => markActive(menu, surface.element, active);

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
        open = true;
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
            if (!open) return;
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
            if (open && slashQuery(surface.getDocument(), selection.focus.path, selection.focus.offset) === undefined) menu.close(false);
        }),
    ];
    // while the slash's list is open its keys come before the editor's: the arrows move, Enter or Tab chooses, Escape closes
    const slashKey = (event: KeyboardEvent) => {
        if (!open || event.isComposing) return;
        const count = items.length ? slashLines().length : 0;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (count) active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            mark();
        } else if (event.key === "Enter" || event.key === "Tab") {
            const item = rows()[active];
            if (item) pick(item);
            else if (folded) unfold();
            else menu.close(false);
        } else if (event.key === "Escape") menu.close(false);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    surface.element.addEventListener("keydown", slashKey, true);
    // as the page scrolls, the cursor's place moves, and the list, tied to it, with it
    const follow = () => {
        if (!open) return;
        const selection = getSelection();
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
        if (rect && (rect.width || rect.height)) Object.assign(anchor.style, { left: `${rect.left}px`, top: `${rect.top}px` });
    };
    addEventListener("scroll", follow, { passive: true });

    return {
        close: () => menu.close(false),
        destroy() {
            menu.close(false);
            for (const stop of stops) stop();
            surface.element.removeEventListener("keydown", slashKey, true);
            removeEventListener("scroll", follow);
            for (const each of [anchor, menu.box]) each.remove();
        },
    };
}
