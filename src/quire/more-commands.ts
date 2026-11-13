// Commands the menu row gained from Google Docs' menus, kept out of editor.ts: each is a line in
// the row (menu-row.ts) whose small menu, where it has one, grows from the menu's word and gives the
// focus back to it on Escape. The editor spreads what this gives into its commands.
//
//   const actions = { ...theOthers, ...moreCommands(surface, { doing, word: (index) => row.words[index]! }) };

import type { Action } from "./bar";
import { recase, type Case } from "./capitals";
import type { RowActions } from "./menu-row";
import type { Surface } from "./surface";
import { flowMenu } from "./ui";

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

/** The commands, by the names menu-row.ts gives them. */
export function moreCommands(_surface: Surface, options: MoreOptions): RowActions {
    const { doing, word } = options;
    const format = () => word(4);
    const capitals = flowMenu("Capitalisation");
    return {
        capitals: () => capitals.open(format(), CASES.map(([how, label]) => ({ label, run: doing(recase(how)) })), true),
    };
}
