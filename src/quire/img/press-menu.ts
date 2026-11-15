// The menu a right-click on the picture opens, as mdQuire's text has one: what can be done with what is
// under the pointer first (a mark or a cover: remove it, bring it forward, send it back), then copy and
// paste, then the one-press fixes for the whole picture (straightening its lines, repairing a JPEG), then
// export. Each is the menus' own line, so it does what that line does, with its shortcut.
// With no picture yet it holds Paste and Choose a picture. The keyboard's menu key, or Shift+F10, opens
// it too; Shift with the right-click leaves the browser's.
//
// Which lines it holds is pressLines, which is pure and tested; the menu itself is in editor.ts.

import { everyLine, RULE, type MenuItem } from "../core/ui";

/** The commands for what is picked, by their names in the menus' table. */
export const PICKED_COMMANDS = ["remove", "forward", "back"];

/** The commands for the picture as a whole, in the menu's order; a rule goes before Export. */
export const PICTURE_COMMANDS = ["copy", "copy-text", "paste", "export"];

/** The one-press fixes for the whole picture, under a rule of their own after Paste, each only when it can be used. */
export const FIX_COMMANDS = ["straighten", "repair"];

/**
 * Every line of the picture's menu, in order, found by name among the menus' lines.
 * With something picked its lines come first, with a rule under them; a line that cannot be used now
 * (nothing to copy, no words read) is left out, except Copy and Paste, which keep their places.
 * With no picture there is Paste, and `choose` for picking a file.
 */
export function pressLines(menus: { items: () => MenuItem[] }[], state: { picture: boolean; picked: boolean }, choose: MenuItem): MenuItem[] {
    const all = menus.flatMap((menu) => everyLine(menu.items()).map((each) => each.item));
    const line = (key: string) => all.find((item) => item.key === key);
    const paste = line("paste");
    if (!state.picture) return [...(paste ? [paste] : []), choose];
    const picked = state.picked ? PICKED_COMMANDS.flatMap((key) => line(key) ?? []) : [];
    const whole = PICTURE_COMMANDS.flatMap((key) => {
        const found = line(key);
        if (!found) return [];
        if (found.disabled && key !== "copy" && key !== "paste") return [];
        return key === "export" ? [RULE, found] : [found];
    });
    const fixes = FIX_COMMANDS.flatMap((key) => {
        const found = line(key);
        return found && !found.disabled ? [found] : [];
    });
    // the fixes after Paste, before Export's rule
    if (fixes.length) whole.splice(whole.indexOf(RULE) < 0 ? whole.length : whole.indexOf(RULE), 0, RULE, ...fixes);
    return [...picked, ...(picked.length ? [RULE] : []), ...whole];
}
