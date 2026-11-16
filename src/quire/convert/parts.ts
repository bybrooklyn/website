// The small pieces the converter's column is built of, on top of every small tool's kit (core/bench.ts),
// the same for every kind so that the same press does the same thing everywhere: a row of round dots
// under its small label, where a choice this browser cannot do is drawn faint, cannot be taken, and
// says why when the pointer rests on it; a number to type with its unit after it; a part that folds
// open by growing from no height; a quiet sentence that grows in and away; and what a kind's group of
// the column gives the page.

import { dots, row, typed, type Dot } from "../core/bench";
import { make } from "../core/ui";
import type { Found, Kind } from "./kinds";

/** One choice in a row: its value, its words, its tooltip, and why it cannot be taken, if it cannot. */
export interface Choice<T extends string> {
    value: T;
    label: string;
    tip?: string;
    cannot?: string;
}

/**
 * A row of round dots under its small label (the kit's dots in the kit's row, its label over it so the words have the column's
 * width), one chosen at a time, the arrow keys moving along it as a browser's own radio buttons do. `bar` says again which choices
 * cannot be taken now and why; `set` shows a value chosen without telling the tool; `after` is put after the dots (a unit).
 */
export function choices<T extends string>(label: string, options: Choice<T>[], initial: T, change: (value: T) => void, after?: Node) {
    let value = initial;
    const cannot = new Map<string, string>();
    const laid = dots<T>(
        label,
        options.map((option): Dot<T> => ({ value: option.value, text: option.label, tip: option.tip })),
        (pressed) => {
            if (cannot.has(pressed)) return;
            set(pressed);
            change(pressed);
        },
    );
    const labels = [...laid.set.querySelectorAll("label")];
    const set = (next: T) => {
        value = next;
        laid.show(next);
    };
    const bar = (list: Choice<T>[]) => {
        cannot.clear();
        list.forEach((option, index) => {
            const element = labels[index];
            if (!element) return;
            const input = element.querySelector("input")!;
            if (option.cannot) cannot.set(option.value, option.cannot);
            input.disabled = !!option.cannot;
            element.classList.toggle("cannot", !!option.cannot);
            const tip = option.cannot ?? option.tip;
            if (tip) element.title = tip;
            else element.removeAttribute("title");
        });
    };
    // a unit goes in the dots' own line, so that it follows the last of them as they wrap
    if (after) laid.set.append(after);
    const element = row(label, laid.set);
    element.classList.add("wide");
    bar(options);
    set(initial);
    return { element, set, value: () => value, bar };
}

/** A unit said after a number or a row of dots: "px", "kbps". */
export function unit(text: string): HTMLElement {
    return make("span", "quire-convert-unit", text);
}

/** A number to type on the kit's line, with its unit after it, read when it changes; a value outside its bounds is brought inside them. */
export function numberField(label: string, unitText: string, value: number, bounds: { least: number; most: number }, change: (value: number) => void) {
    const held = typed(label, () => {}, { kind: "number" });
    const input = held.input as HTMLInputElement;
    input.inputMode = "numeric";
    input.min = String(bounds.least);
    input.max = String(bounds.most);
    input.value = String(value);
    input.classList.add("quire-convert-number");
    const read = () => {
        const typedNow = Math.round(Number(input.value));
        if (!Number.isFinite(typedNow) || input.value.trim() === "") return;
        const kept = Math.min(bounds.most, Math.max(bounds.least, typedNow));
        if (kept !== typedNow) input.value = String(kept);
        change(kept);
    };
    input.addEventListener("change", read);
    input.addEventListener("keydown", (event) => event.key === "Enter" && read());
    held.row.querySelector(".quire-bench-held")!.append(unit(unitText));
    return { element: held.row, input };
}

/** A part that folds open and shut, growing from no height to its own; shut, it is out of reach. */
export function fold(...content: HTMLElement[]) {
    const outer = make("div", "quire-convert-fold");
    const inner = make("div", "quire-convert-fold-in");
    inner.append(...content);
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

/** A quiet sentence in the column, for what this browser cannot do or what a choice means; empty, it has shrunk away. */
export function note(text = ""): HTMLParagraphElement & { say(text: string): void } {
    const paragraph = make("p", "quire-convert-note", text) as HTMLParagraphElement & { say(text: string): void };
    paragraph.say = (words: string) => {
        if (words) paragraph.textContent = words;
        paragraph.classList.toggle("empty", !words);
    };
    paragraph.say(text);
    return paragraph;
}

/** What a file in the list is, as a kind's group of the column sees it. */
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

/** A refusal that comes with something that can be done: the words to press and the choices they make for that file. */
export class Offered extends Error {
    constructor(
        message: string,
        readonly offer: { label: string; options: Record<string, unknown> },
    ) {
        super(message);
    }
}

/** A kind's group of the column: its element, the lane its work runs in, what each file will become, and the work. */
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
