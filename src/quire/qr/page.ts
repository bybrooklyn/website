// The QR code page (/qr/): a maker and a reader in one, everything in this browser. The code is the work:
// it stands in its square at the left (at the top on a phone, staying in view), and the forms and the
// looks have their own room beside it (under it on a phone), never over it. Make: choose what it holds
// (a link or text, Wi-Fi, a contact, an email, a phone call, a text message), and the code changes as
// it is typed, the smallest that holds it, its square the same size whatever its version; then its look
// (shape, eyes, colors, ground, margin, a picture in the middle or as the code, error correction). Each
// code drawn is read back here, and the page says plainly when a look would not be read. Out: Copy, Save
// PNG at a chosen size, Save SVG, named in a few safe letters by what the code holds. Read: a picture
// pasted, dropped, chosen, or pasted from the right-click menu (a Paste button on a phone), and what each
// code in it holds, laid out by its kind, a link shown and copied but never opened. The code has its own
// right-click menu (Shift leaves the browser's); keys for everything.
//
//   createQrPage(host, { grounds: [{ name: "White", value: "#ffffff" }, ...] });

import { flowMenu, make, moveIndex, RULE, type MenuItem } from "../core/ui";
import { normalHex, FLAGS, isHex } from "./colors";
import { contactText, describe, emailText, EMPTY_CONTACT, fileName, messageText, phoneText, wifiText, type Contact, type Kind, type Wifi } from "./content";
import type { Code } from "./encode";
import { readCodes, type Found } from "./read";
import { codeFor, deepenedAny, drawSvg, eyePath, lookWord, MIDDLE_INSET, MIDDLE_SIZES, middleSquare, PLAIN, type EyeShape, type Look, type Paint, type Shape } from "./style";
import { dataBytes, type Level } from "./tables";

/** A color offered by name. */
export interface Swatch {
    name: string;
    value: string;
}

/** What the page is given: the grounds offered besides white and clear (the site's colors). */
export interface PageOptions {
    grounds?: Swatch[];
}

/** The kinds, in the order they are offered, with their names and the key that picks each. */
export const KINDS: { kind: Kind; label: string; key: string }[] = [
    { kind: "text", label: "Link or text", key: "1" },
    { kind: "wifi", label: "Wi-Fi", key: "2" },
    { kind: "contact", label: "Contact", key: "3" },
    { kind: "email", label: "Email", key: "4" },
    { kind: "phone", label: "Phone", key: "5" },
    { kind: "message", label: "Message", key: "6" },
];

/** The inks offered: deep colors that stand well from a light ground. */
export const INKS: Swatch[] = [
    { name: "Black", value: "#000000" },
    { name: "Ink blue", value: "#1d2b64" },
    { name: "Violet", value: "#4b1d7a" },
    { name: "Plum", value: "#7a1d5b" },
    { name: "Red", value: "#9b1c1c" },
    { name: "Rust", value: "#8a3b12" },
    { name: "Forest", value: "#1b5e34" },
    { name: "Teal", value: "#0b5a6e" },
];

/** The levels of error correction, with the words for each and how much of the code each can mend. */
export const LEVEL_WORDS: { level: Level; label: string; tip: string }[] = [
    { level: "L", label: "Low", tip: "Mends about 7 percent of the code" },
    { level: "M", label: "Medium", tip: "Mends about 15 percent of the code" },
    { level: "Q", label: "High", tip: "Mends about 25 percent of the code" },
    { level: "H", label: "Highest", tip: "Mends about 30 percent of the code" },
];

/** The sizes a PNG is saved at, in pixels a side. */
export const PNG_SIZES = [512, 1024, 2048, 4096];

/** The lines of the code's right-click menu: Copy, Save as SVG, Save as PNG, then Paste a picture to read; with no code, only the last. */
export function qrMenuLines(state: { code: boolean }, run: { copy(): void; svg(): void; png(): void; paste(): void }): MenuItem[] {
    const paste: MenuItem = { label: "Paste a picture to read", icon: "paste", hint: "Ctrl+V", key: "paste", run: run.paste };
    if (!state.code) return [paste];
    return [
        { label: "Copy", icon: "copy", hint: "Ctrl+C", key: "copy", run: run.copy },
        { label: "Save as SVG", icon: "download", hint: "Ctrl+Shift+S", key: "svg", run: run.svg },
        { label: "Save as PNG", icon: "download", hint: "Ctrl+S", key: "png", run: run.png },
        RULE,
        paste,
    ];
}

/** The words for a code's size and error correction. */
export function factsOf(code: Code): string {
    const word = LEVEL_WORDS.find((each) => each.level === code.level)!;
    return `Version ${code.version}, ${code.side} by ${code.side} modules, error correction ${word.label.toLowerCase()}.`;
}

/** The words for text too long for any code at a level: its bytes, and the most bytes version 40 holds in byte mode (its data less the mode and length, 20 bits). */
export function tooLongWords(text: string, level: Level): string {
    const bytes = new TextEncoder().encode(text).length;
    return `Too long for a QR code: about ${bytes.toLocaleString("en-US")} bytes, and one holds at most ${Math.floor((dataBytes(40, level) * 8 - 20) / 8).toLocaleString("en-US")} at this error correction. Shorten it, or lower the error correction.`;
}

/** A row of choices, one pressed at a time, moved along by the arrow keys. */
function choices<T extends string>(label: string, options: { value: T; content: string | Node; tip?: string }[], initial: T, change: (value: T) => void) {
    const row = make("div", "quire-qr-choices");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", label);
    let value = initial;
    const buttons = options.map((option) => {
        const button = make("button", "quire-qr-choice");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.value = option.value;
        if (typeof option.content === "string") button.textContent = option.content;
        else button.append(option.content);
        if (option.tip) {
            button.title = option.tip;
            button.setAttribute("aria-label", option.tip);
        }
        button.addEventListener("click", () => {
            set(option.value);
            change(option.value);
        });
        return button;
    });
    row.append(...buttons);
    row.addEventListener("keydown", (event) => {
        const at = buttons.findIndex((each) => each.dataset.value === value);
        const next = moveIndex(at, event.key, buttons.length);
        if (next === undefined) return;
        event.preventDefault();
        buttons[next]!.focus();
        buttons[next]!.click();
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
    set(initial);
    return { element: row, set, value: () => value, buttons };
}

/** A field with its label above it. */
function field(label: string, options: { multiline?: boolean; placeholder?: string; type?: string; autocomplete?: string } = {}) {
    const wrap = make("label", "quire-qr-field");
    wrap.append(make("span", "quire-qr-label", label));
    const input = options.multiline ? make("textarea") : make("input");
    if (input instanceof HTMLInputElement) input.type = options.type ?? "text";
    else input.rows = 3;
    input.className = "quire-qr-input";
    input.spellcheck = false;
    input.autocomplete = (options.autocomplete ?? "off") as AutoFill;
    if (options.placeholder) input.placeholder = options.placeholder;
    wrap.append(input);
    return { wrap, input };
}

/** A part of the panel that folds open and shut, growing from nothing to its height. */
function fold(...content: HTMLElement[]) {
    const outer = make("div", "quire-qr-fold");
    const inner = make("div", "quire-qr-fold-in");
    inner.append(...content);
    outer.append(inner);
    return { element: outer, open: (on: boolean) => ((outer.classList.toggle("open", on)), (inner.inert = !on)) };
}

/** A small titled part of the panel. */
function section(title: string, ...content: HTMLElement[]) {
    const part = make("section", "quire-qr-section");
    part.append(make("h3", "quire-qr-heading", title), ...content);
    return part;
}

/** A sample of a shape for its button: a few modules drawn in it. */
function shapeSample(shape: Shape | EyeShape, eye = false): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", eye ? "-0.5 -0.5 8 8" : "-0.3 -0.3 5.6 5.6");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "quire-qr-sample");
    if (eye) {
        svg.innerHTML = `<path fill-rule="evenodd" d="${eyePath(0, 0, shape as EyeShape)}"/>`;
        return svg;
    }
    // a little pattern of modules: an L, a pair and a single
    const on = new Set(["0,0", "1,0", "2,0", "0,1", "0,2", "3,2", "4,2", "4,3", "2,4", "1,4", "4,4"]);
    const d: string[] = [];
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            if (!on.has(`${x},${y}`)) continue;
            if (shape === "dots") d.push(`M${x + 0.06} ${y + 0.5}a0.44 0.44 0 1 0 0.88 0a0.44 0.44 0 1 0-0.88 0z`);
            else if (shape === "rounded") d.push(`M${x + 0.34} ${y + 0.04}h0.32a0.3 0.3 0 0 1 0.3 0.3v0.32a0.3 0.3 0 0 1-0.3 0.3h-0.32a0.3 0.3 0 0 1-0.3-0.3v-0.32a0.3 0.3 0 0 1 0.3-0.3z`);
            else if (shape === "diamonds") d.push(`M${x + 0.5} ${y - 0.04}l0.54 0.54l-0.54 0.54l-0.54-0.54z`);
            else d.push(`M${x} ${y}h1v1h-1z`);
        }
    }
    if (shape === "bars") svg.innerHTML = `<path d="M0.1 0.05h0.8v2.9h-0.8zM1.1 0.05h0.8v0.9h-0.8zM2.1 0.05h0.8v0.9h-0.8zM4.1 2.05h0.8v2.9h-0.8zM3.1 2.05h0.8v0.9h-0.8zM1.1 4.05h0.8v0.9h-0.8zM2.1 4.05h0.8v0.9h-0.8z" rx="0.4"/>`;
    else if (shape === "joined") svg.innerHTML = `<path d="M0.5 0H3V0.5A0.5 0.5 0 0 1 2.5 1H1V2.5A0.5 0.5 0 0 1 0.5 3A0.5 0.5 0 0 1 0 2.5V0.5A0.5 0.5 0 0 1 0.5 0zM3.5 2H4.5A0.5 0.5 0 0 1 5 2.5V4.5A0.5 0.5 0 0 1 4.5 5A0.5 0.5 0 0 1 4 4.5V3H3.5A0.5 0.5 0 0 1 3.5 2zM1.5 4H2.5A0.5 0.5 0 0 1 2.5 5H1.5A0.5 0.5 0 0 1 1.5 4z"/>`;
    else svg.innerHTML = `<path d="${d.join("")}"/>`;
    return svg;
}

/** A row of color swatches and a field for any color as hex digits; the swatch matching the field is pressed. */
function colorRow(label: string, swatches: Swatch[], initial: string, change: (value: string) => void, extra?: HTMLElement) {
    const row = make("div", "quire-qr-colors");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    const buttons = swatches.map((swatch) => {
        const button = make("button", "quire-qr-swatch");
        button.type = "button";
        button.title = swatch.name;
        button.setAttribute("aria-label", swatch.name);
        button.dataset.value = swatch.value;
        const mark = make("span", "quire-qr-swatch-mark");
        mark.style.background = swatch.value;
        button.append(mark);
        button.addEventListener("click", () => {
            set(swatch.value);
            change(swatch.value);
        });
        return button;
    });
    const hex = make("input", "quire-qr-input quire-qr-hex");
    hex.type = "text";
    hex.spellcheck = false;
    hex.maxLength = 7;
    hex.setAttribute("aria-label", `${label} as hex digits`);
    hex.title = "Any color, as hex digits";
    hex.addEventListener("input", () => {
        if (!isHex(hex.value)) return;
        const value = normalHex(hex.value);
        for (const button of buttons) button.classList.toggle("pressed", button.dataset.value === value);
        change(value);
    });
    row.append(...buttons, ...(extra ? [extra] : []), hex);
    const set = (value: string) => {
        for (const button of buttons) button.classList.toggle("pressed", button.dataset.value === value);
        if (value.startsWith("#") && document.activeElement !== hex) hex.value = value;
    };
    set(initial);
    return { element: row, set, buttons };
}

/** Builds the page on its host. */
export function createQrPage(host: HTMLElement, options: PageOptions = {}) {
    const root = make("div", "quire-qr");
    const stage = make("div", "quire-qr-stage");
    const box = make("div", "quire-qr-box");
    box.tabIndex = 0;
    const codeView = make("div", "quire-qr-code");
    codeView.setAttribute("role", "img");
    const ground = make("div", "quire-qr-ground");
    const throughImage = make("img", "quire-qr-through");
    throughImage.alt = "";
    const svgHolder = make("div", "quire-qr-svg");
    const middleImage = make("img", "quire-qr-middle");
    middleImage.alt = "";
    const empty = make("p", "quire-qr-empty", "Type a link or some text, and its code appears here.");
    codeView.append(ground, throughImage, svgHolder, middleImage, empty);
    const readView = make("div", "quire-qr-read-view");
    const readImage = make("img", "quire-qr-read-image");
    readImage.alt = "The picture being read";
    const readMarks = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    readMarks.setAttribute("class", "quire-qr-read-marks");
    readMarks.setAttribute("aria-hidden", "true");
    const readEmpty = make("p", "quire-qr-empty", "Drop, paste or choose a picture with a QR code in it. It never leaves your browser.");
    readView.append(readImage, readMarks, readEmpty);
    box.append(codeView, readView);
    const said = make("p", "quire-qr-said");
    said.setAttribute("aria-live", "polite");
    const verdict = make("p", "quire-qr-verdict");
    verdict.setAttribute("aria-live", "polite");
    const out = make("div", "quire-qr-out");
    stage.append(box, said, verdict, out);
    const panel = make("div", "quire-qr-panel");
    root.append(stage, panel);
    host.append(root);

    // ---- the state ----
    let mode: "make" | "read" = "make";
    let kind: Kind = "text";
    let text = "";
    let wifi: Wifi = { name: "", password: "", security: "WPA", hidden: false };
    let contact: Contact = { ...EMPTY_CONTACT };
    let email = { to: "", subject: "", body: "" };
    let phone = "";
    let message = { number: "", body: "" };
    let look: Look = { ...PLAIN };
    let paintKind: Paint["kind"] = "solid";
    let solid = "#000000";
    let gradient = { from: "#1d2b64", to: "#b5176f", angle: 45 };
    let flag = "rainbow";
    let pictureMode: "none" | "middle" | "through" = "none";
    let picture: { href: string; url: string; bitmap: ImageBitmap; width: number; height: number } | undefined;
    const lights = new Map<number, Uint8Array>();
    let share = 0.2;
    let colored = true;
    let level: Level = "M";
    let pngSize = 1024;
    let shown: { code: Code; payload: string; look: Look } | undefined;
    let found: Found[] = [];
    let readCount = 0;
    const say = (words: string) => (said.textContent = words);

    // ---- the panel: Make and Read ----
    const modes = choices<"make" | "read">("Make or read", [{ value: "make", content: "Make" }, { value: "read", content: "Read" }], "make", (value) => setMode(value));
    modes.element.classList.add("quire-qr-modes");
    const makePart = make("div", "quire-qr-make");
    const readPart = make("div", "quire-qr-read");
    const parts = make("div", "quire-qr-parts");
    parts.append(makePart, readPart);
    panel.append(modes.element, parts);

    // what it holds
    const kinds = choices<Kind>("What the code holds", KINDS.map((each) => ({ value: each.kind, content: each.label })), "text", (value) => setKind(value));
    kinds.element.classList.add("quire-qr-kinds");
    const forms = make("div", "quire-qr-forms");
    const formOf = new Map<Kind, HTMLElement>();
    const changed = () => draw();
    {
        const form = make("div", "quire-qr-form");
        const one = field("Link or text", { multiline: true, placeholder: "https://" });
        one.input.addEventListener("input", () => ((text = one.input.value), changed()));
        form.append(one.wrap);
        formOf.set("text", form);
    }
    {
        const form = make("div", "quire-qr-form");
        const name = field("Network name", { autocomplete: "off" });
        const password = field("Password");
        const security = choices<Wifi["security"]>("Security", [{ value: "WPA", content: "WPA" }, { value: "WEP", content: "WEP" }, { value: "nopass", content: "None" }], "WPA", (value) => ((wifi = { ...wifi, security: value }), changed()));
        const hidden = choices<"no" | "yes">("Hidden network", [{ value: "no", content: "Shown" }, { value: "yes", content: "Hidden" }], "no", (value) => ((wifi = { ...wifi, hidden: value === "yes" }), changed()));
        name.input.addEventListener("input", () => ((wifi = { ...wifi, name: name.input.value }), changed()));
        password.input.addEventListener("input", () => ((wifi = { ...wifi, password: password.input.value }), changed()));
        const pair = make("div", "quire-qr-pair");
        pair.append(labelled("Security", security.element), labelled("The network's name is", hidden.element));
        form.append(name.wrap, password.wrap, pair);
        formOf.set("wifi", form);
    }
    {
        const form = make("div", "quire-qr-form quire-qr-form-wide");
        const names: [keyof Contact, string, string?][] = [
            ["first", "First name", "given-name"],
            ["last", "Last name", "family-name"],
            ["phone", "Phone", "tel"],
            ["email", "Email", "email"],
            ["organization", "Organization", "organization"],
            ["title", "Job title", "organization-title"],
            ["website", "Website", "url"],
            ["street", "Street", "street-address"],
            ["city", "City", "address-level2"],
            ["region", "State or region", "address-level1"],
            ["postcode", "Postal code", "postal-code"],
            ["country", "Country", "country-name"],
        ];
        for (const [key, label] of names) {
            const one = field(label);
            one.input.addEventListener("input", () => ((contact = { ...contact, [key]: one.input.value }), changed()));
            form.append(one.wrap);
        }
        const note = field("Note", { multiline: true });
        note.wrap.classList.add("quire-qr-whole");
        note.input.addEventListener("input", () => ((contact = { ...contact, note: note.input.value }), changed()));
        form.append(note.wrap);
        formOf.set("contact", form);
    }
    {
        const form = make("div", "quire-qr-form");
        const to = field("To", { type: "email", placeholder: "name@example.com" });
        const subject = field("Subject");
        const body = field("Message", { multiline: true });
        to.input.addEventListener("input", () => ((email = { ...email, to: to.input.value }), changed()));
        subject.input.addEventListener("input", () => ((email = { ...email, subject: subject.input.value }), changed()));
        body.input.addEventListener("input", () => ((email = { ...email, body: body.input.value }), changed()));
        form.append(to.wrap, subject.wrap, body.wrap);
        formOf.set("email", form);
    }
    {
        const form = make("div", "quire-qr-form");
        const number = field("Phone number", { type: "tel", placeholder: "+1 555 123 4567" });
        number.input.addEventListener("input", () => ((phone = number.input.value), changed()));
        form.append(number.wrap);
        formOf.set("phone", form);
    }
    {
        const form = make("div", "quire-qr-form");
        const number = field("Phone number", { type: "tel", placeholder: "+1 555 123 4567" });
        const body = field("Message", { multiline: true });
        number.input.addEventListener("input", () => ((message = { ...message, number: number.input.value }), changed()));
        body.input.addEventListener("input", () => ((message = { ...message, body: body.input.value }), changed()));
        form.append(number.wrap, body.wrap);
        formOf.set("message", form);
    }
    for (const [each, form] of formOf) {
        form.dataset.kind = each;
        forms.append(form);
    }
    function labelled(label: string, content: HTMLElement) {
        const wrap = make("div", "quire-qr-field");
        wrap.append(make("span", "quire-qr-label", label), content);
        return wrap;
    }
    makePart.append(section("What it holds", kinds.element, forms));

    // how it looks
    const shapes = choices<Shape>(
        "Shape",
        (["square", "rounded", "dots", "diamonds", "bars", "joined"] as Shape[]).map((value) => ({ value, content: shapeSample(value), tip: { square: "Squares", rounded: "Rounded squares", dots: "Dots", diamonds: "Diamonds", bars: "Bars", joined: "Joined" }[value] })),
        "square",
        (value) => ((look = { ...look, shape: value }), changed()),
    );
    const eyes = choices<EyeShape>(
        "Corners",
        (["square", "rounded", "round"] as EyeShape[]).map((value) => ({ value, content: shapeSample(value, true), tip: { square: "Square corners", rounded: "Rounded corners", round: "Round corners" }[value] })),
        "square",
        (value) => ((look = { ...look, eyes: value }), changed()),
    );
    const paints = choices<Paint["kind"]>("Color", [{ value: "solid", content: "One color" }, { value: "gradient", content: "Gradient" }, { value: "rainbow", content: "Rainbow" }, { value: "flag", content: "Flag" }], "solid", (value) => ((paintKind = value), foldPaints(), changed()));
    const solidRow = colorRow("Color", INKS, solid, (value) => ((solid = value), changed()));
    const fromRow = colorRow("From", INKS, gradient.from, (value) => ((gradient = { ...gradient, from: value }), changed()));
    const toRow = colorRow("To", [...INKS.slice(1), { name: "Magenta", value: "#b5176f" }], gradient.to, (value) => ((gradient = { ...gradient, to: value }), changed()));
    const angles = choices<string>("Direction", [0, 45, 90, 135].map((angle) => ({ value: String(angle), content: arrow(angle), tip: { 0: "Left to right", 45: "Corner to corner, down", 90: "Top to bottom", 135: "Corner to corner, up" }[angle] })), "45", (value) => ((gradient = { ...gradient, angle: Number(value) }), changed()));
    const flags = choices<string>(
        "Flag",
        FLAGS.map((each) => {
            const mark = make("span", "quire-qr-flag-mark");
            mark.style.background = `linear-gradient(${each.stripes.map((stripe, i) => `${stripe} ${(i / each.stripes.length) * 100}% ${((i + 1) / each.stripes.length) * 100}%`).join(", ")})`;
            return { value: each.name, content: mark, tip: `The ${each.name} flag` };
        }),
        "rainbow",
        (value) => ((flag = value), changed()),
    );
    function arrow(angle: number): SVGSVGElement {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("class", "quire-icon");
        svg.innerHTML = `<g transform="rotate(${angle} 12 12)"><path d="M5 12h14M14 7l5 5-5 5"/></g>`;
        return svg;
    }
    const solidFold = fold(solidRow.element);
    const gradientFold = fold(labelled("From", fromRow.element), labelled("To", toRow.element), labelled("Direction", angles.element));
    const flagFold = fold(flags.element);
    function foldPaints() {
        solidFold.open(paintKind === "solid");
        gradientFold.open(paintKind === "gradient");
        flagFold.open(paintKind === "flag");
    }
    const clearSwatch = make("button", "quire-qr-swatch quire-qr-clear");
    clearSwatch.type = "button";
    clearSwatch.title = "Clear";
    clearSwatch.setAttribute("aria-label", "Clear");
    clearSwatch.append(make("span", "quire-qr-swatch-mark"));
    const groundRow = colorRow("Ground", [{ name: "White", value: "#ffffff" }, ...(options.grounds ?? [])], "#ffffff", (value) => ((look = { ...look, ground: value }), clearSwatch.classList.remove("pressed"), changed()), clearSwatch);
    clearSwatch.addEventListener("click", () => {
        look = { ...look, ground: undefined };
        groundRow.set("");
        clearSwatch.classList.add("pressed");
        changed();
    });
    const marginValue = make("output", "quire-qr-number", String(look.margin));
    const marginLess = make("button", "quire-qr-choice quire-qr-step", "−");
    const marginMore = make("button", "quire-qr-choice quire-qr-step", "+");
    marginLess.type = marginMore.type = "button";
    marginLess.title = "Less margin";
    marginMore.title = "More margin";
    marginLess.setAttribute("aria-label", "Less margin");
    marginMore.setAttribute("aria-label", "More margin");
    const setMargin = (value: number) => {
        look = { ...look, margin: Math.min(8, Math.max(0, value)) };
        marginValue.textContent = String(look.margin);
        changed();
    };
    marginLess.addEventListener("click", () => setMargin(look.margin - 1));
    marginMore.addEventListener("click", () => setMargin(look.margin + 1));
    const marginRow = make("div", "quire-qr-stepper");
    marginRow.append(marginLess, marginValue, marginMore, make("span", "quire-qr-unit", "modules"));
    const levels = choices<Level>("Error correction", LEVEL_WORDS.map((each) => ({ value: each.level, content: each.label, tip: each.tip })), "M", (value) => ((level = value), changed()));
    makePart.append(
        section("Shape", shapes.element),
        section("Corners", eyes.element),
        section("Color", paints.element, solidFold.element, gradientFold.element, flagFold.element),
        section("Ground", groundRow.element),
        section("Margin", marginRow),
    );

    // a picture in the code
    const pictureChooser = make("input");
    pictureChooser.type = "file";
    pictureChooser.accept = "image/*";
    pictureChooser.hidden = true;
    const pictures = choices<"none" | "middle" | "through">("Picture", [{ value: "none", content: "None" }, { value: "middle", content: "In the middle" }, { value: "through", content: "As the code" }], "none", (value) => {
        pictureMode = value;
        foldPicture();
        if (value !== "none" && !picture) pictureChooser.click();
        changed();
    });
    const pictureButton = make("button", "quire-qr-plain", "Choose a picture");
    pictureButton.type = "button";
    pictureButton.addEventListener("click", () => pictureChooser.click());
    const shareInput = make("input", "quire-qr-range");
    shareInput.type = "range";
    shareInput.min = String(MIDDLE_SIZES.least);
    shareInput.max = String(MIDDLE_SIZES.most);
    shareInput.step = String(MIDDLE_SIZES.step);
    shareInput.value = String(share);
    shareInput.setAttribute("aria-label", "Picture size");
    const shareValue = make("output", "quire-qr-number", `${Math.round(share * 100)}%`);
    shareInput.addEventListener("input", () => {
        share = Number(shareInput.value);
        shareValue.textContent = `${Math.round(share * 100)}%`;
        changed();
    });
    const shareRow = make("div", "quire-qr-stepper");
    shareRow.append(shareInput, shareValue);
    const throughKinds = choices<"color" | "halftone">("How the picture shows", [{ value: "color", content: "In color" }, { value: "halftone", content: "Halftone" }], "color", (value) => ((colored = value === "color"), changed()));
    const pictureNow = make("div", "quire-qr-picture-now");
    pictureNow.append(pictureButton);
    const middleFold = fold(labelled("Size", shareRow));
    const throughFold = fold(throughKinds.element);
    const pictureFold = fold(pictureNow, middleFold.element, throughFold.element);
    function foldPicture() {
        pictureFold.open(pictureMode !== "none");
        middleFold.open(pictureMode === "middle");
        throughFold.open(pictureMode === "through");
    }
    const pictureSection = section("Picture", pictures.element, pictureFold.element, pictureChooser);
    makePart.append(pictureSection, section("Error correction", levels.element));
    pictureChooser.addEventListener("change", () => {
        const file = pictureChooser.files?.[0];
        pictureChooser.value = "";
        if (file) void takeCodePicture(file);
    });
    // a picture dropped on this part goes into the code, not to the reader
    pictureSection.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        event.stopPropagation();
        pictureSection.classList.add("dropping");
    });
    pictureSection.addEventListener("dragleave", () => pictureSection.classList.remove("dropping"));
    pictureSection.addEventListener("drop", (event) => {
        pictureSection.classList.remove("dropping");
        const file = [...(event.dataTransfer?.files ?? [])].find((each) => each.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        if (pictureMode === "none") {
            pictureMode = "middle";
            pictures.set("middle");
            foldPicture();
        }
        void takeCodePicture(file);
    });

    /** A picture for the code: kept at most 1024 pixels a side, as a PNG or JPEG data address for the saved SVG and as a blob for the screen. */
    async function takeCodePicture(file: Blob) {
        let bitmap: ImageBitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            say("That is not a picture this browser can read.");
            return;
        }
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const href = canvas.toDataURL(file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp" ? "image/png" : "image/jpeg", 0.9);
        const blob = await new Promise<Blob>((done) => canvas.toBlob((made) => done(made!), href.startsWith("data:image/png") ? "image/png" : "image/jpeg", 0.9));
        if (picture) URL.revokeObjectURL(picture.url);
        picture = { href, url: URL.createObjectURL(blob), bitmap, width: canvas.width, height: canvas.height };
        lights.clear();
        throughImage.src = picture.url;
        middleImage.src = picture.url;
        pictureButton.textContent = "Choose another picture";
        draw();
    }

    /** The picture's lightness at three samples a module across and down over the code's square, cropped to the middle as the colored kind shows it. */
    function lightOf(side: number): Uint8Array {
        const kept = lights.get(side);
        if (kept) return kept;
        const grid = side * 3;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = grid;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        const { bitmap } = picture!;
        const s = Math.min(bitmap.width, bitmap.height);
        context.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, grid, grid);
        const data = context.getImageData(0, 0, grid, grid).data;
        const light = new Uint8Array(grid * grid);
        for (let i = 0; i < light.length; i++) light[i] = Math.round(data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114);
        lights.set(side, light);
        return light;
    }

    // ---- out ----
    const copyButton = make("button", "quire-qr-main", "Copy");
    copyButton.type = "button";
    copyButton.title = "Copy the code as a picture (Ctrl+C)";
    copyButton.addEventListener("click", () => void copy());
    const pngButton = make("button", "quire-qr-plain", "Save PNG");
    pngButton.type = "button";
    pngButton.title = "Save as PNG (Ctrl+S)";
    pngButton.addEventListener("click", () => void savePng());
    const svgButton = make("button", "quire-qr-plain", "Save SVG");
    svgButton.type = "button";
    svgButton.title = "Save as SVG (Ctrl+Shift+S)";
    svgButton.addEventListener("click", () => saveSvg());
    const sizes = choices<string>("PNG size", PNG_SIZES.map((size) => ({ value: String(size), content: String(size), tip: `${size} by ${size} pixels` })), String(pngSize), (value) => (pngSize = Number(value)));
    sizes.element.classList.add("quire-qr-sizes");
    out.append(copyButton, pngButton, svgButton, sizes.element);

    // ---- the reader's part of the panel ----
    const readChooser = make("input");
    readChooser.type = "file";
    readChooser.accept = "image/*";
    readChooser.hidden = true;
    const readChoose = make("button", "quire-qr-main", "Choose a picture");
    readChoose.type = "button";
    readChoose.addEventListener("click", () => readChooser.click());
    const readPaste = make("button", "quire-qr-plain quire-qr-paste", "Paste");
    readPaste.type = "button";
    readPaste.addEventListener("click", () => void pasteFromMenu());
    const readActions = make("div", "quire-qr-actions");
    readActions.append(readChoose, readPaste, readChooser);
    const readSaid = make("p", "quire-qr-read-said", "Drop, paste or choose a picture with a QR code in it.");
    readSaid.setAttribute("aria-live", "polite");
    const results = make("div", "quire-qr-results");
    readPart.append(readActions, readSaid, results);
    readChooser.addEventListener("change", () => {
        const file = readChooser.files?.[0];
        readChooser.value = "";
        if (file) void read(file);
    });

    // ---- drawing the code ----
    /** The text the code holds now, from the form of its kind. */
    function payload(): string {
        if (kind === "text") return text;
        if (kind === "wifi") return wifi.name ? wifiText(wifi) : "";
        if (kind === "contact") return contactText(contact);
        if (kind === "email") return email.to || email.subject || email.body ? emailText(email) : "";
        if (kind === "phone") return phone.replace(/[^0-9+*#]/g, "") ? phoneText(phone) : "";
        return message.number || message.body ? messageText(message) : "";
    }

    /** The look with what it is drawn in now and its picture. */
    function lookNow(code: Code): Look {
        const ink: Paint = paintKind === "solid" ? { kind: "solid", color: solid } : paintKind === "gradient" ? { kind: "gradient", ...gradient } : paintKind === "rainbow" ? { kind: "rainbow" } : { kind: "flag", flag };
        const made: Look = { ...look, ink, middle: undefined, through: undefined };
        if (picture && pictureMode === "middle") made.middle = { href: picture.href, width: picture.width, height: picture.height, size: share };
        if (picture && pictureMode === "through") made.through = { href: picture.href, light: colored ? new Uint8Array() : lightOf(code.side), colored };
        return made;
    }

    let readBackTimer: ReturnType<typeof setTimeout> | undefined;
    let drawCount = 0;
    function draw() {
        const words = payload();
        root.classList.toggle("blank", !words);
        if (!words) {
            shown = undefined;
            svgHolder.replaceChildren();
            codeView.removeAttribute("aria-label");
            empty.textContent = kind === "text" ? "Type a link or some text, and its code appears here." : kind === "wifi" ? "Type the network's name, and its code appears here." : "Fill in the form, and its code appears here.";
            say("");
            verdict.textContent = "";
            return fill();
        }
        const made = codeFor(words, { level, middle: picture && pictureMode === "middle" ? share : undefined, through: !!picture && pictureMode === "through" });
        if (made.problem === "long" || !made.code) {
            // the last code stays, quieted, so nothing jumps; the words say why
            root.classList.add("stale");
            say(tooLongWords(words, level));
            verdict.textContent = "";
            return fill();
        }
        root.classList.remove("stale");
        const code = made.code;
        const drawnLook = lookNow(code);
        shown = { code, payload: words, look: drawnLook };
        const full = code.side + 2 * drawnLook.margin;
        svgHolder.innerHTML = drawSvg(code, drawnLook, { bare: true, id: "quire-qr-shown" });
        codeView.setAttribute("aria-label", `QR code holding: ${words}`);
        // the layers under and over the code: its ground, the picture behind it, the picture in its middle
        ground.style.background = drawnLook.ground ?? "";
        ground.classList.toggle("clear", !drawnLook.ground);
        const percent = (value: number) => `${(value / full) * 100}%`;
        Object.assign(throughImage.style, { left: percent(drawnLook.margin), top: percent(drawnLook.margin), width: percent(code.side), height: percent(code.side) });
        throughImage.classList.toggle("shown", !!drawnLook.through?.colored);
        if (drawnLook.middle) {
            const { from, width } = middleSquare(code.side, share);
            const inner = width - 2 * MIDDLE_INSET;
            Object.assign(middleImage.style, { left: percent(drawnLook.margin + from + MIDDLE_INSET), top: percent(drawnLook.margin + from + MIDDLE_INSET), width: percent(inner), height: percent(inner), borderRadius: `${(Math.min(1.2, width / 6) / inner) * 100}%` });
        }
        middleImage.classList.toggle("shown", !!drawnLook.middle);
        const facts = factsOf(code);
        const notes: string[] = [];
        if (made.problem === "picture") notes.push("The picture covers more than the code can mend. Make it smaller.");
        const colors = drawnLook.through ? undefined : lookWord(drawnLook);
        if (colors) notes.push(colors);
        if (!drawnLook.through && deepenedAny(drawnLook.ink, drawnLook.ground)) notes.push("The flag's light stripes are drawn deeper so phones can read them.");
        if (drawnLook.middle && made.code.level !== level) notes.push("Error correction is raised so the picture can sit in the middle.");
        say([facts, ...notes].join(" "));
        verdict.textContent = "Reading it back";
        verdict.className = "quire-qr-verdict";
        clearTimeout(readBackTimer);
        const count = ++drawCount;
        readBackTimer = setTimeout(() => void readBack(count), 220);
        fill();
    }

    /** Draws the code as it will be saved, reads it with the reader, and says whether it reads back. */
    async function readBack(count: number) {
        if (!shown) return;
        const { code, payload: words, look: drawnLook } = shown;
        const perModule = drawnLook.through && !drawnLook.through.colored ? 6 : 5;
        const size = Math.max(320, (code.side + 2 * drawnLook.margin) * perModule);
        try {
            const canvas = await rasterize(code, drawnLook, size);
            if (count !== drawCount) return;
            const pixels = canvas.getContext("2d")!.getImageData(0, 0, size, size);
            const reads = readCodes(pixels).some((each) => each.text === words);
            if (count !== drawCount) return;
            verdict.textContent = reads ? "It reads back as written." : "It does not read back here, so phones may not read it either.";
            verdict.className = `quire-qr-verdict ${reads ? "good" : "bad"}`;
        } catch {
            if (count === drawCount) verdict.textContent = "";
        }
    }

    /** The code in a look drawn by the browser into a canvas of this size, on white where it is clear. */
    async function rasterize(code: Code, drawnLook: Look, size: number, keepClear = false): Promise<HTMLCanvasElement> {
        const svg = drawSvg(code, drawnLook, { size });
        const image = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        try {
            image.src = url;
            await image.decode();
        } finally {
            URL.revokeObjectURL(url);
        }
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        if (!keepClear) {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, size, size);
        }
        context.drawImage(image, 0, 0, size, size);
        return canvas;
    }

    // ---- getting it out ----
    const nameOf = (extension: string) => fileName(kind, shown?.payload ?? "", extension);
    async function pngOf(size: number): Promise<Blob> {
        if (!shown) throw new Error("there is no code yet");
        const canvas = await rasterize(shown.code, shown.look, size, true);
        return new Promise((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("the picture could not be made"))), "image/png"));
    }
    async function copy() {
        if (!shown) return;
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(pngSize) })]);
            say(`Copied, ${pngSize} by ${pngSize} pixels.`);
        } catch (error) {
            say(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    function download(blob: Blob, name: string) {
        const link = make("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        say(`Saved as ${name}.`);
    }
    async function savePng() {
        if (!shown) return;
        try {
            download(await pngOf(pngSize), nameOf("png"));
        } catch (error) {
            say(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    function saveSvg() {
        if (!shown) return;
        const svg = drawSvg(shown.code, shown.look, { size: pngSize, id: "qr", title: shown.payload.slice(0, 200) });
        download(new Blob([svg], { type: "image/svg+xml" }), nameOf("svg"));
    }

    // ---- reading ----
    /** Reads a picture: shows it, finds every code in it, and lays out what each holds. */
    async function read(file: Blob) {
        setMode("read");
        const count = ++readCount;
        let bitmap: ImageBitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            readSaid.textContent = "That is not a picture this browser can read.";
            return;
        }
        if (readImage.src.startsWith("blob:")) URL.revokeObjectURL(readImage.src);
        readImage.src = URL.createObjectURL(file);
        root.classList.add("has-picture");
        readSaid.textContent = "Reading";
        results.replaceChildren();
        readMarks.replaceChildren();
        // the reading waits a frame, so the picture is seen first
        await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(bitmap, 0, 0);
        found = readCodes(context.getImageData(0, 0, bitmap.width, bitmap.height));
        if (count !== readCount) return;
        // top to bottom, then left to right, as they are read on a page
        const middleOf = (each: Found) => ({ x: each.corners.reduce((s, c) => s + c.x, 0) / 4, y: each.corners.reduce((s, c) => s + c.y, 0) / 4 });
        found.sort((a, b) => (Math.abs(middleOf(a).y - middleOf(b).y) > bitmap.height / 8 ? middleOf(a).y - middleOf(b).y : middleOf(a).x - middleOf(b).x));
        readSaid.textContent = found.length === 0 ? "No QR code found in this picture." : found.length === 1 ? "Found one code." : `Found ${found.length} codes.`;
        readMarks.setAttribute("viewBox", `0 0 ${bitmap.width} ${bitmap.height}`);
        const stroke = Math.max(2, Math.max(bitmap.width, bitmap.height) / 250);
        found.forEach((each, index) => {
            const mark = document.createElementNS("http://www.w3.org/2000/svg", "g");
            mark.setAttribute("class", "quire-qr-mark");
            mark.style.setProperty("--delay", `${index * 60}ms`);
            const outline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            outline.setAttribute("points", each.corners.map((c) => `${c.x},${c.y}`).join(" "));
            outline.setAttribute("stroke-width", String(stroke));
            const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", String(each.corners[0]!.x));
            label.setAttribute("y", String(each.corners[0]!.y - stroke * 2));
            label.setAttribute("font-size", String(stroke * 9));
            label.textContent = found.length > 1 ? String(index + 1) : "";
            mark.append(outline, label);
            readMarks.append(mark);
            results.append(card(each, index));
        });
        fill();
    }

    /** What one code holds, as a card: its kind, its lines, and Copy beside each. */
    function card(each: Found, index: number): HTMLElement {
        const said = describe(each.text);
        const made = make("article", "quire-qr-card");
        made.style.setProperty("--delay", `${index * 60}ms`);
        const head = make("div", "quire-qr-card-head");
        head.append(make("h3", "quire-qr-card-title", found.length > 1 ? `${index + 1}. ${said.title}` : said.title));
        const copyAll = make("button", "quire-qr-plain", "Copy all");
        copyAll.type = "button";
        copyAll.title = "Copy everything the code holds, as it is written";
        copyAll.addEventListener("click", () => void copyText(each.text, "Copied what the code holds."));
        head.append(copyAll);
        made.append(head);
        const list = make("dl", "quire-qr-lines");
        for (const line of said.lines) {
            const row = make("div", "quire-qr-line");
            const value = make("dd", said.link && line.value === said.link ? "quire-qr-value quire-qr-link" : "quire-qr-value", line.value);
            const copyOne = make("button", "quire-qr-plain quire-qr-copy-one", "Copy");
            copyOne.type = "button";
            copyOne.title = `Copy the ${line.label.toLowerCase()}`;
            copyOne.setAttribute("aria-label", `Copy the ${line.label.toLowerCase()}`);
            copyOne.addEventListener("click", () => void copyText(line.value, `Copied the ${line.label.toLowerCase()}.`));
            row.append(make("dt", "quire-qr-line-label", line.label), value, copyOne);
            list.append(row);
        }
        made.append(list);
        const facts = make("p", "quire-qr-card-facts", `Version ${each.read.version}, error correction ${LEVEL_WORDS.find((word) => word.level === each.read.level)!.label.toLowerCase()}${each.light ? ", light on dark" : ""}${each.read.mended ? `, ${each.read.mended} ${each.read.mended === 1 ? "byte" : "bytes"} mended` : ""}.`);
        made.append(facts);
        return made;
    }
    async function copyText(value: string, words: string) {
        try {
            await navigator.clipboard.writeText(value);
            readSaid.textContent = words;
        } catch (error) {
            readSaid.textContent = `Not copied: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async function pasteFromMenu() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await read(await item.getType(type)));
            }
            setMode("read");
            readSaid.textContent = "There is no picture on the clipboard.";
        } catch {
            setMode("read");
            readSaid.textContent = "Press Ctrl+V to paste.";
        }
    }

    // ---- modes, kinds, and what is shown ----
    function setKind(next: Kind) {
        kind = next;
        kinds.set(next);
        fill();
        draw();
    }
    function setMode(next: "make" | "read") {
        mode = next;
        modes.set(next);
        fill();
    }
    function fill() {
        root.classList.toggle("reading", mode === "read");
        makePart.inert = mode !== "make";
        readPart.inert = mode !== "read";
        out.inert = mode !== "make" || !shown;
        for (const [each, form] of formOf) {
            const on = each === kind;
            form.classList.toggle("shown", on);
            form.inert = !on;
        }
        // the forms' room grows or shrinks to the one shown, from the height it had
        forms.style.height = `${formOf.get(kind)!.offsetHeight}px`;
        parts.style.height = `${(mode === "make" ? makePart : readPart).offsetHeight}px`;
    }

    // ---- the four ways a picture comes to be read: paste, drop, choose, and Paste from the menu or the phone's button ----
    const pictureIn = (data: DataTransfer | null) => [...(data?.files ?? [])].find((each) => each.type.startsWith("image/"));
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
        const file = pictureIn(event.clipboardData);
        if (!file) return;
        event.preventDefault();
        void read(file);
    };
    document.addEventListener("paste", pasted);
    root.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        root.classList.add("dropping");
    });
    root.addEventListener("dragleave", (event) => {
        if (!root.contains(event.relatedTarget as Node | null)) root.classList.remove("dropping");
    });
    root.addEventListener("drop", (event) => {
        root.classList.remove("dropping");
        const file = pictureIn(event.dataTransfer);
        if (!file) return;
        event.preventDefault();
        void read(file);
    });

    // ---- the code's right-click menu ----
    const menu = flowMenu("QR code", { className: "quire-img-press-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    function openMenu(x: number, y: number) {
        Object.assign(anchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!anchor.isConnected) document.body.append(anchor);
        const lines = qrMenuLines({ code: mode === "make" && !!shown }, { copy: () => void copy(), svg: saveSvg, png: () => void savePng(), paste: () => void pasteFromMenu() });
        menu.open(anchor, lines, false);
        menu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    box.addEventListener("contextmenu", (event) => {
        // Shift leaves the browser's own menu
        if (event.shiftKey) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
    });

    // ---- the keys ----
    const keys = (event: KeyboardEvent) => {
        const typing = event.target instanceof HTMLElement && !!event.target.closest("input, textarea");
        const command = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && document.activeElement === box) {
            event.preventDefault();
            const at = box.getBoundingClientRect();
            return openMenu(at.left + at.width / 2, at.top + at.height / 2);
        }
        if (command && key === "o") {
            event.preventDefault();
            return readChooser.click();
        }
        if (typing) return;
        if (command && key === "c" && shown && mode === "make" && !getSelection()?.toString()) {
            event.preventDefault();
            void copy();
        } else if (command && key === "s" && shown && mode === "make") {
            event.preventDefault();
            if (event.shiftKey) saveSvg();
            else void savePng();
        } else if (!command && !event.altKey && /^[1-6]$/.test(event.key) && mode === "make") {
            event.preventDefault();
            setKind(KINDS.find((each) => each.key === event.key)!.kind);
        } else if (!command && !event.altKey && (key === "m" || key === "r")) {
            event.preventDefault();
            setMode(key === "m" ? "make" : "read");
        }
    };
    document.addEventListener("keydown", keys);
    const resized = new ResizeObserver(() => fill());
    for (const form of formOf.values()) resized.observe(form);
    resized.observe(makePart);
    resized.observe(readPart);

    foldPaints();
    foldPicture();
    fill();
    draw();
    root.classList.add("ready");
    return {
        element: root,
        read,
        /** The code shown and the text it holds, for tests. */
        shown: () => shown,
        found: () => found,
        destroy() {
            document.removeEventListener("paste", pasted);
            document.removeEventListener("keydown", keys);
            resized.disconnect();
            root.remove();
            anchor.remove();
        },
    };
}
