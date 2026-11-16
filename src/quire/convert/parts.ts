// The small pieces the converter's panel is built of, the same for every kind so that the same press
// does the same thing everywhere: a row of choices (one pressed at a time, the arrow keys moving along
// it, a choice this browser cannot do shown dimmed with the reason shown when the pointer rests on it), a part that folds
// open by growing from no height, a titled section, a field with its unit, and what a kind's side of
// the panel gives the page.

import { make, moveIndex } from "../core/ui";
import type { Found, Kind } from "./kinds";

/** One choice in a row: its value, its words, its tooltip, and why it cannot be pressed, if it cannot. */
export interface Choice<T extends string> {
    value: T;
    label: string;
    tip?: string;
    cannot?: string;
}

/** A row of choices, one pressed at a time, moved along by the arrow keys; a choice that cannot be pressed is passed over. */
export function choices<T extends string>(label: string, options: Choice<T>[], initial: T, change: (value: T) => void) {
    const row = make("div", "quire-convert-choices");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", label);
    let value = initial;
    let buttons: HTMLButtonElement[] = [];
    const build = (list: Choice<T>[]) => {
        buttons = list.map((option) => {
            const button = make("button", "quire-convert-choice", option.label);
            button.type = "button";
            button.setAttribute("role", "radio");
            button.dataset.value = option.value;
            const tip = option.cannot ?? option.tip;
            if (tip) button.title = tip;
            if (option.cannot) {
                button.setAttribute("aria-disabled", "true");
                button.classList.add("cannot");
            }
            button.addEventListener("click", () => {
                if (option.cannot) return;
                set(option.value);
                change(option.value);
            });
            return button;
        });
        row.replaceChildren(...buttons);
        set(value);
    };
    row.addEventListener("keydown", (event) => {
        const usable = buttons.filter((each) => !each.classList.contains("cannot"));
        const at = usable.findIndex((each) => each.dataset.value === value);
        const next = moveIndex(at, event.key, usable.length);
        if (next === undefined) return;
        event.preventDefault();
        usable[next]!.focus();
        usable[next]!.click();
    });
    const set = (next: T) => {
        value = next;
        for (const button of buttons) {
            const on = button.dataset.value === next;
            button.classList.toggle("pressed", on);
            button.setAttribute("aria-checked", String(on));
            button.tabIndex = on ? 0 : -1;
        }
    };
    build(options);
    return { element: row, set, value: () => value, rebuild: build };
}

/** A part that folds open and shut, growing from no height to its own. */
export function fold(...content: HTMLElement[]) {
    const outer = make("div", "quire-convert-fold");
    const inner = make("div", "quire-convert-fold-in");
    const pad = make("div", "quire-convert-fold-pad");
    pad.append(...content);
    inner.append(pad);
    outer.append(inner);
    inner.inert = true;
    return {
        element: outer,
        open(on: boolean) {
            outer.classList.toggle("open", on);
            inner.inert = !on;
        },
    };
}

/** A titled section of the panel. */
export function section(title: string, ...content: HTMLElement[]): HTMLElement {
    const part = make("section", "quire-convert-section");
    part.append(make("h2", "quire-convert-heading", title), ...content);
    return part;
}

/** A line of the panel: its words on the left and its control beside them. */
export function line(label: string, ...content: HTMLElement[]): HTMLElement {
    const row = make("div", "quire-convert-line");
    row.append(make("span", "quire-convert-label", label), ...content);
    return row;
}

/** A quiet sentence in the panel, for what this browser cannot do or what a choice means; empty takes no room. */
export function note(text = ""): HTMLParagraphElement & { say(text: string): void } {
    const paragraph = make("p", "quire-convert-note", text) as HTMLParagraphElement & { say(text: string): void };
    paragraph.say = (words: string) => {
        paragraph.textContent = words;
        paragraph.classList.toggle("empty", !words);
    };
    paragraph.say(text);
    return paragraph;
}

/** A number field with its unit after it, read when it changes; a value outside its bounds is brought inside them. */
export function numberField(label: string, unit: string, value: number, bounds: { least: number; most: number }, change: (value: number) => void) {
    const wrap = make("label", "quire-convert-number");
    const input = make("input", "quire-convert-field");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = String(bounds.least);
    input.max = String(bounds.most);
    input.value = String(value);
    input.setAttribute("aria-label", label);
    const read = () => {
        const typed = Math.round(Number(input.value));
        if (!Number.isFinite(typed) || input.value.trim() === "") return;
        const kept = Math.min(bounds.most, Math.max(bounds.least, typed));
        if (kept !== typed) input.value = String(kept);
        change(kept);
    };
    input.addEventListener("change", read);
    input.addEventListener("keydown", (event) => event.key === "Enter" && read());
    wrap.append(input, make("span", "quire-convert-unit", unit));
    return { element: wrap, input };
}

/** What a file in the list is, as a kind's side of the panel sees it. */
export interface Item {
    file: Blob;
    name: string;
    found: Found;
    /** Choices made for this file alone, as when she took an offer after a refusal. */
    options: Record<string, unknown>;
}

/** What a file will become: the words and ending, or why it cannot be converted here. */
export type Becoming = { label: string; ending: string } | { cannot: string };

/** What a conversion made: the bytes, and what to say about it. */
export interface Made {
    blob: Blob;
    /** What changed in the file's own size, in a few words, put after what it is: "4032 × 3024 to 2048 × 1536". */
    facts?: string;
    /** What it became, in a few words, put in place of what it was to become: "Opus in Ogg, 48 kHz stereo, 3:25". */
    became?: string;
    notes: string[];
    /** The text made, for text and data, so that it can be copied. */
    text?: string;
}

/** A refusal that comes with something that can be done: the words of a button and the choices it makes for that file. */
export class Offered extends Error {
    constructor(
        message: string,
        readonly offer: { label: string; options: Record<string, unknown> },
    ) {
        super(message);
    }
}

/** A kind's side of the panel: its section, the lane its work runs in, what each file will become, and the work. */
export interface Side {
    kind: Kind;
    element: HTMLElement;
    lane: string;
    becomes(item: Item): Becoming;
    run(item: Item, signal: AbortSignal, told: (share: number, words?: string) => void): Promise<Made>;
    /** A closer look at a file as it arrives (the text's own kind, a film's tracks), when the first bytes are not enough. */
    identify?(item: Item): Promise<Found | undefined>;
    /** The page sets this, to hear when a choice changes what files will become. */
    changed?: () => void;
}
