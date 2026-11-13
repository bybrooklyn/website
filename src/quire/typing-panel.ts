// Tools, Typing preferences: everything typing turns into (the table in vocabulary.ts), each with a
// switch, grouped by where its meaning comes from, so that standard Markdown's own marks can be
// switched as one. It opens in the editor's dialog, out of the menu word pressed. What is switched
// off stays as typed, and is kept in this browser by the editor.
//
//   openTyping(from, { isOn, set, onClose });
//
// Which rows a group's switch turns (`groupTurned`) is pure and tested.

import { openDialog } from "./dialog";
import { make } from "./ui";
import { GROUPS } from "./vocabulary";

/** The ids a group's switch leaves switched off: all of the group's rows when they were all on, none of them when any was off. */
export function groupTurned(off: ReadonlySet<string>, ids: string[]): Set<string> {
    const allOn = ids.every((id) => !off.has(id));
    const next = new Set(off);
    for (const id of ids) {
        if (allOn) next.add(id);
        else next.delete(id);
    }
    return next;
}

/** What the panel is given: which rows are on, and a way to set the whole of what is off. */
export interface TypingChoices {
    off: () => ReadonlySet<string>;
    set: (off: Set<string>) => void;
    onClose?: () => void;
}

/** A switch drawn as a track with a knob, the whole line pressable. */
function toggle(label: Node[], on: boolean, press: () => void, className = "quire-switch"): HTMLButtonElement {
    const button = make("button", className);
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(on));
    const words = make("span", "quire-switch-label");
    words.append(...label);
    button.append(words, make("span", "quire-switch-track"));
    button.addEventListener("click", press);
    return button;
}

/** Opens the panel out of `from`. */
export function openTyping(from: HTMLElement, choices: TypingChoices) {
    const intro = make("p", "quire-typing-intro", "What typing turns into. Switch one off to keep what you type as it is.");
    const list = make("div", "quire-keys quire-typing");
    // each switch, with whether it shows on: drawn once, and set again after every press
    const shown: [HTMLButtonElement, () => boolean][] = [];
    const change = (next: Set<string>) => {
        choices.set(next);
        for (const [button, on] of shown) button.setAttribute("aria-checked", String(on()));
    };
    for (const group of GROUPS) {
        const ids = group.rows.map((row) => row.id);
        const allOn = () => ids.every((id) => !choices.off().has(id));
        const head = toggle([make("span", "", group.all)], allOn(), () => change(groupTurned(choices.off(), ids)), "quire-switch quire-switch-group");
        shown.push([head, allOn]);
        list.append(make("h3", "quire-keys-head", group.title), head);
        for (const row of group.rows) {
            const on = () => !choices.off().has(row.id);
            const turn = () => {
                const next = new Set(choices.off());
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                change(next);
            };
            const line = toggle([make("code", "quire-typing-typed", row.typed), make("span", "quire-typing-becomes", row.becomes)], on(), turn);
            shown.push([line, on]);
            list.append(line);
        }
    }
    openDialog(from, { title: "Typing preferences", body: [intro, list], className: "quire-keys-dialog quire-typing-dialog", action: { label: "Done", press: (_, dialog) => void dialog.close() }, onClose: choices.onClose });
}
