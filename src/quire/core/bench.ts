// The parts every small tool's page is built from (the cut-out, the QR codes, the converter), so that
// they are one design and the site's own: one box with a rule round it, as a mini's is; the work on the
// left with one line under it saying what is being done and what was done; and on the right a column of
// controls written the way the Walker's column is (src/styles/minis.css): a small heading for each
// group, round dots for a choice of one, words in the accent to press, thin rules between. No boxed
// buttons, and every label in lowercase, as the site's labels are, names keeping their capitals (`lowered`;
// the lines of a menu keep a first capital, `raised`). A group with nothing to act on yet is
// made `inert`, which draws it faint, so nothing appears from nowhere. Besides those there is a row (a
// small muted label, then what it names), a line to type on, a slider, a number with less and more
// either side of it, and a row of colors. Their look is quire-bench.css.
//
//   const box = bench("Cut-out");
//   box.hold(room);
//   const laid = dots("background", [{ value: "clear", text: "clear" }, ...], (value) => lay(value));
//   box.side.append(laid.group, group(undefined, word("copy", copy), word("save", save, true)), stack(undefined, word("choose another picture", choose, true)));
//   laid.show("clear");
//   box.say("Cut out in 2.2 s.");

import { make } from "./ui";

/** Names that keep their capital in a label though only their first letter is one; others are known by a capital inside them. */
const NAMES = ["Markdown", "Opus", "Ogg", "Mbps", "Google", "Drive", "Hugging", "Face", "Chrome", "Chromium", "Firefox", "Safari"];

/**
 * A label in the site's lowercase: every word made small but for names, which are written as they are properly written. A name is a
 * word with a capital after its first letter (PNG, WebP, Wi-Fi, GitHub, mdQuire, kHz), one of two letters or more with no small letter
 * in it (A4, OK, P3), or one of the few listed that have only a first capital (Markdown, Opus), with or without "'s" after it. So
 * "Save PNG" is "save PNG", "Network name" is "network name" and "A third" is "a third". The hint inside a field is no label: it
 * keeps its first capital, as a tooltip and a sentence do.
 */
export function lowered(text: string): string {
    return text.replace(/[A-Za-z][A-Za-z0-9.'-]*/g, (word) => (NAMES.includes(word.replace(/'s$/, "")) || /[A-Z]/.test(word.slice(1)) || (word.length > 1 && !/[a-z]/.test(word)) ? word : word.toLowerCase()));
}

/** A line of a menu from a label: its first letter a capital, as the lines of menus are written ("choose files" is "Choose files"). */
export function raised(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

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

/** A row of a group: a small muted label, then what it names, on the column's own grid (as the Walker's rows are). */
export function row(label: string, ...inside: Node[]): HTMLElement {
    const made = make("div", "quire-bench-row");
    const held = make("div", "quire-bench-held");
    held.append(...inside);
    made.append(make("span", "quire-bench-label", label), held);
    return made;
}

/** Something of the column that holds a value: its row, the thing itself, and `set`, which shows a value without telling the tool. */
export interface Held<T, E extends HTMLElement = HTMLElement> {
    row: HTMLElement;
    input: E;
    set(value: T): void;
}

/**
 * A line to type on, as the site's are: a rule under the words, the accent while it is typed on. `change` is told as it is typed.
 * `many` makes it a box of several lines; `kind` is the input's type ("text", "url", "password"); `wide` gives it the group's whole
 * width, its label over it.
 */
export function typed(label: string, change: (value: string) => void, options: { hint?: string; many?: boolean; kind?: string; wide?: boolean } = {}): Held<string, HTMLInputElement | HTMLTextAreaElement> {
    const input = options.many ? make("textarea", "quire-bench-typed") : make("input", "quire-bench-typed");
    if (input instanceof HTMLInputElement) input.type = options.kind ?? "text";
    else input.rows = 3;
    if (options.hint) input.placeholder = options.hint;
    input.setAttribute("aria-label", label);
    input.spellcheck = false;
    input.addEventListener("input", () => change(input.value));
    const made = row(label, input);
    if (options.wide || options.many) made.classList.add("wide");
    return { row: made, input, set: (value) => void (input.value = value) };
}

/** A slider with its value said after it. `change` is told as it is dragged; `say` puts the value into words ("85", "48 kHz"). */
export function slide(label: string, range: { min: number; max: number; step?: number }, change: (value: number) => void, say: (value: number) => string = String): Held<number, HTMLInputElement> {
    const input = make("input", "quire-bench-slide");
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step ?? 1);
    input.setAttribute("aria-label", label);
    const said = make("output", "quire-bench-value");
    const show = () => {
        said.textContent = say(Number(input.value));
        // how far along it is, for the filled part of its track
        input.style.setProperty("--along", `${((Number(input.value) - range.min) / (range.max - range.min || 1)) * 100}%`);
    };
    input.addEventListener("input", () => {
        show();
        change(Number(input.value));
    });
    const made = row(label, input, said);
    return { row: made, input, set: (value) => ((input.value = String(value)), show()) };
}

/** A whole number with less and more either side of it, as the Dice's "add" is; it stops at the range's ends. */
export function count(label: string, range: { min: number; max: number }, change: (value: number) => void, say: (value: number) => string = String): Held<number> {
    let now = range.min;
    const said = make("output", "quire-bench-value quire-bench-count");
    const step = (by: number) => {
        const next = Math.max(range.min, Math.min(range.max, now + by));
        if (next === now) return;
        show(next);
        change(next);
    };
    const less = word("−", () => step(-1));
    less.setAttribute("aria-label", `${label}: less`);
    const more = word("+", () => step(1));
    more.setAttribute("aria-label", `${label}: more`);
    const show = (value: number) => {
        now = value;
        said.textContent = say(value);
        less.disabled = value <= range.min;
        more.disabled = value >= range.max;
    };
    const made = row(label, less, said, more);
    made.classList.add("quire-bench-counted");
    show(now);
    return { row: made, input: said, set: show };
}

/** A color to pick, named in its tooltip. */
export interface Swatch {
    name: string;
    value: string;
}

/** A row of colors to pick one of, each a round dot of the color itself; `show` rings the one chosen (or none). */
export function swatches(label: string, colors: Swatch[], pick: (value: string) => void): { set: HTMLElement; show(chosen: string | undefined): void } {
    const set = make("div", "quire-bench-swatches");
    set.setAttribute("role", "group");
    set.setAttribute("aria-label", label);
    const buttons = colors.map((each) => {
        const button = make("button", "quire-bench-swatch");
        button.type = "button";
        button.title = each.name;
        button.setAttribute("aria-label", each.name);
        button.dataset.color = each.value;
        button.style.setProperty("--swatch", each.value);
        button.addEventListener("click", () => pick(each.value));
        set.append(button);
        return button;
    });
    return { set, show: (chosen) => buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.color === chosen))) };
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

/** One of the small pictures a pictured row chooses between: its value, the picture, and the words that name it (its tooltip, and what assistive tools say). */
export interface Pictured<T extends string> {
    value: T;
    picture: Node;
    tip: string;
}

/**
 * A row of dots whose choices are small pictures (a shape, a corner, a flag), drawn quietly with no box round them, the one chosen
 * in the accent with a short rule under it. It is a row of dots in every other way: a group with its small heading, radio inputs
 * underneath (moved along by the arrow keys), `press` told the value pressed, and the pictures showing only what `show` was last
 * told.
 */
export function pictured<T extends string>(heading: string, options: Pictured<T>[], press: (value: T, input: HTMLInputElement) => void): Dots {
    const made = dots(
        heading,
        options.map((option) => ({ value: option.value, text: "", tip: option.tip })),
        press,
    );
    made.set.classList.add("quire-bench-pictured");
    made.set.querySelectorAll("label").forEach((label, index) => {
        const option = options[index]!;
        label.querySelector("input")!.setAttribute("aria-label", option.tip);
        label.append(option.picture);
    });
    return made;
}

/**
 * Something of the column that is there only some of the time (a group only a batch has, a line only one format needs): it folds
 * shut and grows open again, and while shut it is out of reach, never drawn faint. `shown` says which it is to be now.
 */
export function fold<E extends HTMLElement>(thing: E, shown: boolean): E {
    thing.classList.add("quire-bench-fold");
    thing.classList.toggle("away", !shown);
    thing.inert = !shown;
    return thing;
}

/** A thing that is on or off, as a box to tick before its words: its row, the box itself, and `set`, which shows it on or off without telling the tool. */
export function tick(label: string, change: (on: boolean) => void, tip?: string): Held<boolean, HTMLInputElement> {
    const input = make("input");
    input.type = "checkbox";
    input.addEventListener("change", () => change(input.checked));
    const made = make("label", "quire-bench-tick");
    if (tip) made.title = tip;
    made.append(input, label);
    return { row: made, input, set: (on) => void (input.checked = on) };
}
