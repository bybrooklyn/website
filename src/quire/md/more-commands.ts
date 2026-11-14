// Commands the menu row gained from Google Docs' menus, kept out of editor.ts: the lines of the menus
// that open beside Format, Text, Capitalization and Format, Bullets and numbering, List options, and
// the small forms beside Insert, Bookmark and List options, Restart numbering. The editor puts what
// this gives among its commands.
//
//   const more = moreCommands(surface, { doing, done: () => row.menu.close(false), title });

import { setStyleOf, type Action } from "./bar";
import { addBookmark, suggestedName } from "./bookmarks";
import { recase, type Case } from "./capitals";
import type { List } from "./document";
import type { RowActions } from "./menus";
import { continuePrevious, listHere, markWith, restartAt } from "./numbering";
import type { Surface } from "./surface";
import { fieldForm, RULE, type MenuItem } from "../core/ui";

/** What the commands need from the editor: how a change is made, and how the menus are put away once a form is filled in. */
export interface MoreOptions {
    doing: (action: Action) => () => void;
    done: () => void;
    /** Goes to the title, the line above the writing that is the document's name. */
    title: () => void;
}

/** The three capitalizations, in Docs' order and its words. */
const CASES: [Case, string][] = [
    ["lower", "lowercase"],
    ["upper", "UPPERCASE"],
    ["title", "Title Case"],
];

/** The three characters a bullet can be written with. Markdown reads all three as the same bullet, and the site draws them alike: only the character saved changes. */
const MARKERS: [List["marker"], string][] = [
    ["-", "Dash"],
    ["*", "Asterisk"],
    ["+", "Plus"],
];

/** The commands, by the names menu-row.ts gives them. */
export function moreCommands(surface: Surface, options: MoreOptions): Pick<RowActions, "title" | "subtitle" | "subs" | "forms"> {
    const { doing, done } = options;
    /** A field beside its line: Enter puts the menus away and does what was asked, and Escape steps back to the line. */
    const form = (field: Parameters<typeof fieldForm>[0], set: (typed: string) => void) => {
        const made = fieldForm(field, {
            set: (typed) => {
                done();
                set(typed);
            },
        });
        requestAnimationFrame(() => made.querySelector("input")?.select());
        return made;
    };
    const listLines = (): MenuItem[] => {
        const here = listHere(surface.getDocument(), surface.getSelection().focus.path);
        if (!here) return [];
        const carry: MenuItem = { label: "Continue previous list", icon: "continue", run: doing(continuePrevious) };
        if (here.list.style === "number") return [{ label: "Restart numbering", icon: "number", form: restart, run: () => {} }, carry];
        return [...MARKERS.map(([marker, label]): MenuItem => ({ label, hint: marker, group: "marker", pressed: here.list.marker === marker, words: ["bullet character"], run: doing(markWith(marker)) })), RULE, carry];
    };
    const restart = () => form({ value: "1", label: "Number to start from", type: "number", button: "Restart", said: "Restart the numbering" }, (typed) => (/^\d{1,9}$/.test(typed) ? doing(restartAt(Number(typed)))() : surface.focus()));
    const bookmark = () => {
        const state = { doc: surface.getDocument(), selection: surface.getSelection() };
        return form({ value: suggestedName(state), label: "Bookmark name", button: "Add", said: "Add the bookmark" }, (typed) => doing(addBookmark(typed || suggestedName(state)))());
    };
    return {
        subs: { capitals: () => CASES.map(([how, label]) => ({ label, run: doing(recase(how)) })), lists: listLines },
        forms: { bookmark },
        // Markdown has no title: the document's is the line above the writing, its name, and Title goes there
        title: options.title,
        subtitle: doing(setStyleOf("subtitle")),
    };
}
