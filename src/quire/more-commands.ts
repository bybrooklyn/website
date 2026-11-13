// Commands the menu row gained from Google Docs' menus, kept out of editor.ts: each is a line in
// the row (menu-row.ts) whose small menu, where it has one, grows from the menu's word and gives the
// focus back to where it was on Escape. The editor spreads what this gives into its commands.
//
//   const actions = { ...theOthers, ...moreCommands(surface, { doing, word: (index) => row.words[index]! }) };

import type { Action } from "./bar";
import { recase, type Case } from "./capitals";
import type { List } from "./document";
import type { RowActions } from "./menu-row";
import { continuePrevious, listHere, markWith, restartAt } from "./numbering";
import type { Surface } from "./surface";
import { fieldForm, flowMenu, type MenuItem } from "./ui";

/** What the commands need from the editor: how a change is made, and the menu row's words to grow from. */
export interface MoreOptions {
    doing: (action: Action) => () => void;
    word: (index: number) => HTMLElement;
}

/** The three capitalisations, in Docs' order and its words. */
const CASES: [Case, string][] = [
    ["lower", "lowercase"],
    ["upper", "UPPERCASE"],
    ["title", "Title Case"],
];

/** The three signs a bullet can be written with. */
const MARKERS: [List["marker"], string][] = [
    ["-", "Written with a dash"],
    ["*", "Written with a star"],
    ["+", "Written with a plus"],
];

/** The commands, by the names menu-row.ts gives them. */
export function moreCommands(surface: Surface, options: MoreOptions): RowActions {
    const { doing, word } = options;
    const format = () => word(4);
    const capitals = flowMenu("Capitalisation");
    const lists = flowMenu("Bullets and numbering");
    const starting = flowMenu("Restart numbering");
    const note = (label: string): MenuItem => ({ label, note: true, run: () => {} });
    const restart = () => {
        const form = fieldForm({ value: "1", label: "Number to start from", type: "number", button: "Restart", said: "Restart the numbering" }, {
            set: (typed) => {
                starting.close(false);
                if (/^\d{1,9}$/.test(typed)) doing(restartAt(Number(typed)))();
                else surface.focus();
            },
            cancel: () => starting.close(true),
        });
        starting.open(format(), form);
        form.querySelector("input")?.select();
    };
    const listLines = (): MenuItem[] => {
        const here = listHere(surface.getDocument(), surface.getSelection().focus.path);
        if (!here) return [note("Put the cursor in a list to choose its bullet or its numbers")];
        const carry = { label: "Continue previous list", run: doing(continuePrevious) };
        if (here.list.style === "number") return [{ label: "Restart numbering", hint: "›", run: restart }, carry];
        // Markdown reads all three as the same bullet, and the site draws them alike: only the character saved changes
        return [...MARKERS.map(([marker, label]): MenuItem => ({ label, hint: marker, group: "marker", pressed: here.list.marker === marker, run: doing(markWith(marker)) })), note("All three are drawn alike, as Markdown reads them"), carry];
    };
    return {
        capitals: () => capitals.open(format(), CASES.map(([how, label]) => ({ label, run: doing(recase(how)) })), true),
        lists: () => lists.open(format(), listLines(), true),
    };
}
