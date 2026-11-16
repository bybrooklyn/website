// The parts every small tool's page is built from (the cut-out, the QR codes, the converter), so that
// they are one design and the site's own: one box with a rule round it, as a mini's is; the work on the
// left with one line under it saying what is being done and what was done; and on the right a column of
// controls written the way the Walker's column is (src/styles/minis.css): a small heading for each
// group, round dots for a choice of one, words in the accent to press, thin rules between. No boxed
// buttons, and every label in lowercase, as the site's labels are. A group with nothing to act on yet is
// made `inert`, which draws it faint, so nothing appears from nowhere. Their look is quire-bench.css.
//
//   const box = bench("Cut-out");
//   box.hold(room);
//   const laid = dots("background", [{ value: "clear", text: "clear" }, ...], (value) => lay(value));
//   box.side.append(laid.group, group(undefined, word("copy", copy), word("save", save, true)), stack(undefined, word("choose another picture", choose, true)));
//   laid.show("clear");
//   box.say("Cut out in 2.2 s.");

import { make } from "./ui";

/** A word to press, in the accent and underlined as the site's are; a `quiet` one is muted until pointed at. */
export function word(text: string, press: (button: HTMLButtonElement) => void, quiet = false): HTMLButtonElement {
    const button = make("button", quiet ? "quire-bench-press quiet" : "quire-bench-press", text);
    button.type = "button";
    button.addEventListener("click", () => press(button));
    return button;
}

/** A group of the column: its small heading, if it has one, then what is in it. */
export function group(heading: string | undefined, ...inside: Node[]): HTMLElement {
    const made = make("div", "quire-bench-group");
    if (heading) made.append(make("h3", "quire-bench-heading", heading));
    made.append(...inside);
    return made;
}

/** A group whose words stand one under another, each on its own line (the lesser things, at the column's foot). */
export function stack(heading: string | undefined, ...inside: Node[]): HTMLElement {
    const made = group(heading, ...inside);
    made.classList.add("quire-bench-stack");
    return made;
}

/** One of the words a row of dots chooses between, with what its tooltip says. */
export interface Dot<T extends string> {
    value: T;
    text: string;
    tip?: string;
}

/** A row of dots: its group, the row itself, and `show`, which fills the dot of the value chosen (or none). */
export interface Dots {
    group: HTMLElement;
    set: HTMLElement;
    show(chosen: string | undefined): void;
}

let named = 0;

/**
 * A group of the column that chooses one of several words: its small heading, then a round dot before each word. `press` is told the
 * word pressed, also when it is the one already chosen, so that a thing held (a brush) can be put down by pressing it again. The dots
 * show what `show` was last told, never what was pressed: the tool says what is chosen.
 */
export function dots<T extends string>(heading: string, options: Dot<T>[], press: (value: T, input: HTMLInputElement) => void): Dots {
    const set = make("div", "quire-bench-choices");
    set.setAttribute("role", "radiogroup");
    set.setAttribute("aria-label", heading);
    const name = `quire-bench-${named++}`;
    let chosen: string | undefined;
    const inputs = options.map((option) => {
        const input = make("input");
        input.type = "radio";
        input.name = name;
        input.value = option.value;
        input.addEventListener("click", () => {
            // the dot goes back to what is chosen until the tool says otherwise, so a choice that was refused never shows as made
            const pressed = option.value;
            show(chosen);
            press(pressed, input);
        });
        const label = make("label");
        if (option.tip) label.title = option.tip;
        label.append(input, option.text);
        set.append(label);
        return input;
    });
    const show = (value: string | undefined) => {
        chosen = value;
        for (const input of inputs) input.checked = input.value === value;
    };
    return { group: group(heading, set), set, show };
}

/** A tool's box: the work's side, the column, and the one line under the work. */
export interface Bench {
    root: HTMLElement;
    /** The left side: the work goes in before the status line, which is its last child. */
    work: HTMLElement;
    /** The column of controls. */
    side: HTMLElement;
    status: HTMLElement;
    /** Puts a thing in the work's side, over the status line. */
    hold(...things: Node[]): void;
    /** Says a line under the work. */
    say(text: string): void;
    /** While `on`, shows what is being done in the line's place (the words given, or those last given). */
    busy(on: boolean, words?: string): void;
}

/** Builds a tool's box, named for assistive tools by `label`; `className` adds the tool's own class to it. */
export function bench(label: string, className = ""): Bench {
    const root = make("div", `quire-bench ${className}`.trim());
    const work = make("div", "quire-bench-work");
    const working = make("p", "quire-bench-working");
    working.setAttribute("role", "status");
    const said = make("p", "quire-bench-said");
    said.setAttribute("aria-live", "polite");
    const status = make("div", "quire-bench-status");
    status.append(working, said);
    work.append(status);
    const side = make("div", "quire-bench-side");
    side.setAttribute("role", "group");
    side.setAttribute("aria-label", label);
    root.append(work, side);
    return {
        root,
        work,
        side,
        status,
        hold: (...things) => status.before(...things),
        say: (text) => void (said.textContent = text),
        busy(on, words) {
            if (words !== undefined) working.textContent = words;
            working.classList.toggle("shown", on);
            root.classList.toggle("busy", on);
        },
    };
}
