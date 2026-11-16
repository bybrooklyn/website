// The QR code page (/qr/): a maker and a reader in one, everything in this browser. It is one box, as
// every small tool's is (core/bench.ts): the code is the work, in its square on the left with one line
// under it, staying in view while the column beside it scrolls past; the column is written the way the
// site's own controls are (the Walker's column): a small heading for each group, round dots for a choice
// of one, small pictures for the shapes, lines to type on, words in the accent to press, thin rules
// between, everything in lowercase. Make: choose what it holds (a link or text, Wi-Fi, a contact, an
// email, a phone call, a text message), and the code changes as it is typed, the smallest that holds it,
// its square the same size whatever its version; then its look (shape, corners, color, ground, margin, a
// picture in the middle or as the code, error correction). Each code drawn is read back here, and the
// line says plainly when a look would not be read. At the column's foot: the PNG's size, then copy, save
// png and save svg, named in a few safe letters by what the code holds. Read: a picture pasted, dropped,
// chosen, or pasted from the right-click menu (a plain paste on a phone), and what each code in it holds,
// laid out by its kind, a link shown and copied but never opened. The code has its own right-click menu
// (Shift leaves the browser's); keys for everything.
//
//   createQrPage(host, { grounds: [{ name: "Violet", value: "#b48cff" }, ...] });

import { bench, count, dots, group, lowered, pictured, row, slide, type Swatch, swatches, typed, word } from "../core/bench";
import { flowMenu, make, RULE, still, type MenuItem } from "../core/ui";
import { normalHex, FLAGS, isHex } from "./colors";
import { contactText, describe, emailText, EMPTY_CONTACT, fileName, messageText, phoneText, wifiText, type Contact, type Kind, type Wifi } from "./content";
import type { Code } from "./encode";
import { readCodes, type Found } from "./read";
import { codeFor, deepenedAny, drawSvg, eyePath, lookWord, modulesPath, MIDDLE_INSET, MIDDLE_SIZES, middleSquare, PLAIN, type EyeShape, type Look, type Paint, type Shape } from "./style";
import { dataBytes, type Level } from "./tables";

/** A color offered by name (the kit's). */
export type { Swatch };

/** What the page is given: the grounds offered besides white and clear (the site's colors). */
export interface PageOptions {
    grounds?: Swatch[];
}

/** The kinds, in the order they are offered, with their names and the key that picks each. */
export const KINDS: { kind: Kind; label: string; key: string }[] = [
    { kind: "text", label: "link or text", key: "1" },
    { kind: "wifi", label: "Wi-Fi", key: "2" },
    { kind: "contact", label: "contact", key: "3" },
    { kind: "email", label: "email", key: "4" },
    { kind: "phone", label: "phone", key: "5" },
    { kind: "message", label: "message", key: "6" },
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
    { level: "L", label: "low", tip: "Mends about 7 percent of the code" },
    { level: "M", label: "medium", tip: "Mends about 15 percent of the code" },
    { level: "Q", label: "high", tip: "Mends about 25 percent of the code" },
    { level: "H", label: "highest", tip: "Mends about 30 percent of the code" },
];

/** The sizes a PNG is saved at, in pixels a side. */
export const PNG_SIZES = [512, 1024, 2048, 4096];

/** The words of the column, in the order they stand: each group's small heading, then what is in it. Every one is lowercase, as the site's labels are. */
export const QR_WORDS = {
    modes: "make or read",
    holds: "what it holds",
    shape: "shape",
    corners: "corners",
    color: "color",
    ground: "ground",
    margin: "margin",
    picture: "picture",
    level: "error correction",
    sizes: "PNG size",
    copy: "copy",
    png: "save PNG",
    svg: "save SVG",
    choose: "choose a picture",
    chooseAnother: "choose another picture",
    paste: "paste",
    copyAll: "copy all",
    copyOne: "copy",
};

/** The lines of the code's right-click menu, each with a first capital as the lines of menus are: Copy, Save as SVG, Save as PNG, then Paste a picture to read; with no code, only the last. */
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
    return `Version ${code.version}, ${code.side} by ${code.side} modules, error correction ${word.label}.`;
}

/** The words for text too long for any code at a level: its bytes, and the most bytes version 40 holds in byte mode (its data less the mode and length, 20 bits). */
export function tooLongWords(text: string, level: Level): string {
    const bytes = new TextEncoder().encode(text).length;
    return `Too long for a QR code: about ${bytes.toLocaleString("en-US")} bytes, and one holds at most ${Math.floor((dataBytes(40, level) * 8 - 20) / 8).toLocaleString("en-US")} at this error correction. Shorten it, or lower the error correction.`;
}

/** A part of the column that folds open and shut, growing from no height to its own and back. */
function fold(...content: Node[]) {
    const outer = make("div", "quire-qr-fold");
    const inner = make("div", "quire-qr-fold-in");
    // the room around the content is inside what is clipped, so a shut fold takes no height at all
    const pad = make("div", "quire-qr-fold-pad");
    pad.append(...content);
    inner.append(pad);
    outer.append(inner);
    return { element: outer, open: (on: boolean) => ((outer.classList.toggle("open", on)), (inner.inert = !on)) };
}

/** A sample of a shape for its picture: a few modules drawn in it. */
function shapeSample(shape: Shape | EyeShape, eye = false): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", eye ? "-0.5 -0.5 8 8" : "-0.3 -0.3 5.6 5.6");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "quire-qr-sample");
    if (eye) {
        svg.innerHTML = `<path fill-rule="evenodd" d="${eyePath(0, 0, shape as EyeShape)}"/>`;
        return svg;
    }
    // a little square of modules, drawn by the code's own drawing so the picture shows exactly what it makes
    const pattern = [1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0];
    const sample = { side: 4, modules: Uint8Array.from(pattern), parts: new Uint8Array(16) } as unknown as Code;
    svg.setAttribute("viewBox", "-0.15 -0.15 4.3 4.3");
    svg.innerHTML = `<path d="${modulesPath(sample, shape as Shape)}"/>`;
    return svg;
}

/** An arrow for a gradient's direction, turned by its angle. */
function arrow(angle: number): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "quire-qr-arrow");
    svg.innerHTML = `<g transform="rotate(${angle} 12 12)"><path d="M5 12h14M14 7l5 5-5 5"/></g>`;
    return svg;
}

/** What is said of a file that is no picture, with its name when it has one. */
const notPicture = (file: Blob): string => {
    const name = (file as File).name;
    return name ? `${name} is not a picture this browser can read.` : "That is not a picture this browser can read.";
};

/** The kit's row of colors with a line under it for any color as hex digits; the color matching the line is ringed. */
function colorPick(label: string, colors: Swatch[], initial: string, change: (value: string) => void) {
    const picked = swatches(label, colors, (value) => {
        set(value);
        change(value);
    });
    // the color in use: what the line goes back to when what was typed is no color
    let inUse = initial;
    const hex = typed(`${label} as hex digits`, (value) => {
        if (!isHex(value)) return;
        const color = normalHex(value);
        inUse = color;
        picked.show(color);
        change(color);
    }).input as HTMLInputElement;
    // left, or Enter pressed: the line says the color in use, written the one way. Digits that are no color (two, five, a word) had
    // stayed in the line while the code kept another color, with nothing to say so
    const settle = () => {
        if (inUse.startsWith("#")) hex.value = inUse;
    };
    hex.addEventListener("change", settle);
    hex.addEventListener("blur", settle);
    hex.addEventListener("keydown", (event) => {
        if (event.key === "Enter") settle();
    });
    hex.classList.add("quire-qr-hex");
    hex.maxLength = 7;
    hex.autocomplete = "off";
    hex.title = "Any color, as hex digits";
    const line = make("div", "quire-qr-color");
    line.append(picked.set, hex);
    const set = (value: string) => {
        inUse = value;
        picked.show(value);
        if (value.startsWith("#") && document.activeElement !== hex) hex.value = value;
    };
    set(initial);
    return { element: line, set };
}

/** Builds the page on its host. */
export function createQrPage(host: HTMLElement, options: PageOptions = {}) {
    // the box every small tool is built from (core/bench.ts): the code's side, one line under it, and the column
    const box = bench("QR codes", "quire-qr");
    const { root, side } = box;
    const square = make("div", "quire-qr-box");
    square.tabIndex = 0;
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
    square.append(codeView, readView);
    const room = make("div", "quire-qr-room");
    room.append(square);
    box.hold(room);
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

    // ---- the one line under the code: the maker's and the reader's each kept, and the one of the mode shown said ----
    const saidLine = box.status.querySelector<HTMLElement>(".quire-bench-said")!;
    let makeLine: { words: string; verdict?: { words: string; kind: "" | "good" | "bad" } } = { words: "" };
    let readLine = "";
    function sayLine() {
        if (mode === "read") return box.say(readLine);
        box.say(makeLine.words);
        // whether it reads back follows what it is, marked by a small dot (quire-qr.css)
        const verdict = makeLine.verdict;
        if (verdict) saidLine.append(makeLine.words ? " " : "", make("span", `quire-qr-verdict ${verdict.kind}`.trim(), verdict.words));
    }
    const say = (words: string) => ((makeLine = { words }), sayLine());
    const sayRead = (words: string) => ((readLine = words), sayLine());

    // ---- the column: make or read ----
    const modes = dots<"make" | "read">(
        QR_WORDS.modes,
        [
            { value: "make", text: "make" },
            { value: "read", text: "read" },
        ],
        (value) => setMode(value),
    );
    const makePart = make("div", "quire-qr-make");
    const readPart = make("div", "quire-qr-read");
    const parts = make("div", "quire-qr-parts");
    parts.append(makePart, readPart);
    side.append(modes.group, parts);

    // what it holds: the kinds, and the lines to type on of the one chosen, each growing open under them
    const changed = () => draw();
    const kinds = dots<Kind>(
        QR_WORDS.holds,
        KINDS.map((each) => ({ value: each.kind, text: each.label })),
        (value) => setKind(value),
    );
    const formOf = new Map<Kind, ReturnType<typeof fold>>();
    /** A row with its label over it and the group's whole width, as every row of the maker's column is, since the column is too narrow for a long label beside its line. */
    const widely = (label: string, ...inside: Node[]) => {
        const made = row(label, ...inside);
        made.classList.add("wide");
        return made;
    };
    /** A line to type on in a form, its label over it, its value told to `change`. */
    const line = (label: string, change: (value: string) => void, more: { hint?: string; many?: boolean; kind?: string } = {}) => {
        const made = typed(label, change, { ...more, wide: true });
        made.input.autocomplete = "off";
        return made.row;
    };
    formOf.set("text", fold(line("link or text", (value) => ((text = value), changed()), { many: true, hint: "https://" })));
    {
        const security = dots<Wifi["security"]>(
            "security",
            [
                { value: "WPA", text: "WPA" },
                { value: "WEP", text: "WEP" },
                { value: "nopass", text: "none" },
            ],
            (value) => ((wifi = { ...wifi, security: value }), security.show(value), (password.inert = value === "nopass"), changed()),
        );
        security.show(wifi.security);
        // a network with no security has no password: the line is there, faint and out of reach, and the code leaves it out
        const password = line("password", (value) => ((wifi = { ...wifi, password: value }), changed()));
        const hidden = dots<"no" | "yes">(
            "Hidden network",
            [
                { value: "no", text: "shown" },
                { value: "yes", text: "hidden" },
            ],
            (value) => ((wifi = { ...wifi, hidden: value === "yes" }), hidden.show(value), changed()),
        );
        hidden.show("no");
        formOf.set("wifi", fold(line("network name", (value) => ((wifi = { ...wifi, name: value }), changed())), password, widely("security", security.set), widely("the network's name is", hidden.set)));
    }
    {
        const names: [keyof Contact, string][] = [
            ["first", "first name"],
            ["last", "last name"],
            ["phone", "phone"],
            ["email", "email"],
            ["organization", "organization"],
            ["title", "job title"],
            ["website", "website"],
            ["street", "street"],
            ["city", "city"],
            ["region", "state or region"],
            ["postcode", "postal code"],
            ["country", "country"],
        ];
        const rows = names.map(([key, label]) => line(label, (value) => ((contact = { ...contact, [key]: value }), changed())));
        rows.push(line("note", (value) => ((contact = { ...contact, note: value }), changed()), { many: true }));
        formOf.set("contact", fold(...rows));
    }
    formOf.set(
        "email",
        fold(
            line("to", (value) => ((email = { ...email, to: value }), changed()), { kind: "email", hint: "name@example.com" }),
            line("subject", (value) => ((email = { ...email, subject: value }), changed())),
            line("message", (value) => ((email = { ...email, body: value }), changed()), { many: true }),
        ),
    );
    formOf.set("phone", fold(line("phone number", (value) => ((phone = value), changed()), { kind: "tel", hint: "+1 555 123 4567" })));
    formOf.set(
        "message",
        fold(
            line("phone number", (value) => ((message = { ...message, number: value }), changed()), { kind: "tel", hint: "+1 555 123 4567" }),
            line("message", (value) => ((message = { ...message, body: value }), changed()), { many: true }),
        ),
    );
    for (const [each, form] of formOf) {
        form.element.classList.add("quire-qr-form");
        form.element.dataset.kind = each;
        kinds.group.append(form.element);
    }

    // how it looks
    const shapeTips: Record<Shape, string> = { square: "Squares", rounded: "Rounded squares", dots: "Dots", diamonds: "Diamonds", bars: "Bars", joined: "Joined" };
    const shapes = pictured<Shape>(
        QR_WORDS.shape,
        (Object.keys(shapeTips) as Shape[]).map((value) => ({ value, picture: shapeSample(value), tip: shapeTips[value] })),
        (value) => ((look = { ...look, shape: value }), shapes.show(value), changed()),
    );
    const eyeTips: Record<EyeShape, string> = { square: "Square corners", rounded: "Rounded corners", round: "Round corners" };
    const eyes = pictured<EyeShape>(
        QR_WORDS.corners,
        (Object.keys(eyeTips) as EyeShape[]).map((value) => ({ value, picture: shapeSample(value, true), tip: eyeTips[value] })),
        (value) => ((look = { ...look, eyes: value }), eyes.show(value), changed()),
    );
    const paints = dots<Paint["kind"]>(
        QR_WORDS.color,
        [
            { value: "solid", text: "one color" },
            { value: "gradient", text: "gradient" },
            { value: "rainbow", text: "rainbow" },
            { value: "flag", text: "flag" },
        ],
        (value) => ((paintKind = value), paints.show(value), foldPaints(), changed()),
    );
    const solidPick = colorPick("Color", INKS, solid, (value) => ((solid = value), changed()));
    const fromPick = colorPick("From", INKS, gradient.from, (value) => ((gradient = { ...gradient, from: value }), changed()));
    const toPick = colorPick("To", [...INKS.slice(1), { name: "Magenta", value: "#b5176f" }], gradient.to, (value) => ((gradient = { ...gradient, to: value }), changed()));
    const angleTips: Record<number, string> = { 0: "Left to right", 45: "Corner to corner, down", 90: "Top to bottom", 135: "Corner to corner, up" };
    const angles = pictured<string>(
        "direction",
        [0, 45, 90, 135].map((angle) => ({ value: String(angle), picture: arrow(angle), tip: angleTips[angle]! })),
        (value) => ((gradient = { ...gradient, angle: Number(value) }), angles.show(value), changed()),
    );
    const flags = pictured<string>(
        "flag",
        FLAGS.map((each) => {
            const mark = make("span", "quire-qr-flag-mark");
            mark.style.background = `linear-gradient(${each.stripes.map((stripe, i) => `${stripe} ${(i / each.stripes.length) * 100}% ${((i + 1) / each.stripes.length) * 100}%`).join(", ")})`;
            return { value: each.name, picture: mark, tip: `The ${each.name} flag` };
        }),
        (value) => ((flag = value), flags.show(value), changed()),
    );
    const solidFold = fold(solidPick.element);
    const gradientFold = fold(widely("from", fromPick.element), widely("to", toPick.element), widely("direction", angles.set));
    const flagFold = fold(flags.set);
    paints.group.append(solidFold.element, gradientFold.element, flagFold.element);
    function foldPaints() {
        solidFold.open(paintKind === "solid");
        gradientFold.open(paintKind === "gradient");
        flagFold.open(paintKind === "flag");
    }
    // clear is offered as the last of the grounds, drawn as a checkerboard (quire-qr.css)
    const groundPick = colorPick("Ground", [{ name: "White", value: "#ffffff" }, ...(options.grounds ?? []), { name: "Clear", value: "clear" }], "#ffffff", (value) => ((look = { ...look, ground: value === "clear" ? undefined : value }), changed()));
    const groundGroup = group(QR_WORDS.ground, groundPick.element);
    const margin = count(QR_WORDS.margin, { min: 0, max: 8 }, (value) => ((look = { ...look, margin: value }), changed()));
    margin.set(look.margin);
    margin.row.querySelector(".quire-bench-held")!.append(make("span", "quire-qr-unit", "modules"));
    // the group's heading names it, so the row's own label is kept for assistive tools only
    const marginGroup = group(QR_WORDS.margin, margin.row);
    marginGroup.classList.add("quire-qr-margin");

    // a picture in the code
    const pictureChooser = make("input");
    pictureChooser.type = "file";
    pictureChooser.accept = "image/*";
    pictureChooser.hidden = true;
    const pictures = dots<"none" | "middle" | "through">(
        QR_WORDS.picture,
        [
            { value: "none", text: "none" },
            { value: "middle", text: "in the middle" },
            { value: "through", text: "as the code" },
        ],
        (value) => {
            pictureMode = value;
            pictures.show(value);
            foldPicture();
            if (value !== "none" && !picture) pictureChooser.click();
            changed();
        },
    );
    const pictureWord = word(QR_WORDS.choose, () => pictureChooser.click());
    const shareSlide = slide("size", { min: MIDDLE_SIZES.least, max: MIDDLE_SIZES.most, step: MIDDLE_SIZES.step }, (value) => ((share = value), changed()), (value) => `${Math.round(value * 100)}%`);
    shareSlide.set(share);
    const throughKinds = dots<"color" | "halftone">(
        "How the picture shows",
        [
            { value: "color", text: "in color" },
            { value: "halftone", text: "halftone" },
        ],
        (value) => ((colored = value === "color"), throughKinds.show(value), changed()),
    );
    throughKinds.show("color");
    const pictureNow = make("div", "quire-qr-picture-now");
    pictureNow.append(pictureWord);
    shareSlide.row.classList.add("wide");
    const middleFold = fold(shareSlide.row);
    const throughFold = fold(throughKinds.set);
    const pictureFold = fold(pictureNow, middleFold.element, throughFold.element);
    pictures.group.append(pictureFold.element, pictureChooser);
    function foldPicture() {
        pictureFold.open(pictureMode !== "none");
        middleFold.open(pictureMode === "middle");
        throughFold.open(pictureMode === "through");
    }
    pictureChooser.addEventListener("change", () => {
        const file = pictureChooser.files?.[0];
        pictureChooser.value = "";
        if (file) void takeCodePicture(file);
    });
    // a picture dropped on this group goes into the code, not to the reader
    const pictureGroup = pictures.group;
    pictureGroup.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        event.stopPropagation();
        pictureGroup.classList.add("dropping");
    });
    pictureGroup.addEventListener("dragleave", () => pictureGroup.classList.remove("dropping"));
    pictureGroup.addEventListener("drop", (event) => {
        pictureGroup.classList.remove("dropping");
        const file = [...(event.dataTransfer?.files ?? [])].find((each) => each.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        if (pictureMode === "none") {
            pictureMode = "middle";
            pictures.show("middle");
            foldPicture();
        }
        void takeCodePicture(file);
    });
    const levels = dots<Level>(
        QR_WORDS.level,
        LEVEL_WORDS.map((each) => ({ value: each.level, text: each.label, tip: each.tip })),
        (value) => ((level = value), levels.show(value), changed()),
    );

    // ---- out, at the column's foot ----
    const sizes = dots<string>(
        QR_WORDS.sizes,
        PNG_SIZES.map((size) => ({ value: String(size), text: String(size), tip: `${size} by ${size} pixels` })),
        (value) => ((pngSize = Number(value)), sizes.show(value)),
    );
    const copyWord = word(QR_WORDS.copy, () => void copy());
    copyWord.title = "Copy the code as a picture (Ctrl+C)";
    const pngWord = word(QR_WORDS.png, () => void savePng(), true);
    pngWord.title = "Save as PNG (Ctrl+S)";
    const svgWord = word(QR_WORDS.svg, () => saveSvg(), true);
    svgWord.title = "Save as SVG (Ctrl+Shift+S)";
    const out = group(undefined, copyWord, pngWord, svgWord);
    out.classList.add("quire-qr-out");
    makePart.append(kinds.group, shapes.group, eyes.group, paints.group, groundGroup, marginGroup, pictureGroup, levels.group, sizes.group, out);

    /** A picture for the code: kept at most 1024 pixels a side, as a PNG or JPEG data address for the saved SVG and as a blob for the screen. */
    async function takeCodePicture(file: Blob) {
        let bitmap: ImageBitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            say(notPicture(file));
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
        // once there is a picture, choosing another is a lesser thing
        pictureWord.textContent = QR_WORDS.chooseAnother;
        pictureWord.classList.add("quiet");
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

    // ---- the reader's part of the column ----
    const readChooser = make("input");
    readChooser.type = "file";
    readChooser.accept = "image/*";
    readChooser.hidden = true;
    const readChoose = word(QR_WORDS.choose, () => readChooser.click());
    const readPaste = word(QR_WORDS.paste, () => void pasteFromMenu(), true);
    readPaste.classList.add("quire-qr-paste");
    const readActions = group(undefined, readChoose, readPaste, readChooser);
    readPart.append(readActions);
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
            return fill();
        }
        const made = codeFor(words, { level, middle: picture && pictureMode === "middle" ? share : undefined, through: !!picture && pictureMode === "through" });
        if (made.problem === "long" || !made.code) {
            // the last code stays, quieted, so nothing jumps; the words say why
            root.classList.add("stale");
            say(tooLongWords(words, level));
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
        makeLine = { words: [facts, ...notes].join(" "), verdict: { words: "Reading it back", kind: "" } };
        sayLine();
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
            makeLine = { words: makeLine.words, verdict: reads ? { words: "It reads back as written.", kind: "good" } : { words: "It does not read back here, so phones may not read it either.", kind: "bad" } };
        } catch {
            if (count !== drawCount) return;
            makeLine = { words: makeLine.words };
        }
        sayLine();
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
            // what was read before is taken away: left there, it looked as if it came from this file
            for (const card of readPart.querySelectorAll(".quire-qr-card")) card.remove();
            readMarks.replaceChildren();
            found = [];
            if (readImage.src.startsWith("blob:")) URL.revokeObjectURL(readImage.src);
            readImage.removeAttribute("src");
            root.classList.remove("has-picture");
            sayRead(notPicture(file));
            return;
        }
        if (readImage.src.startsWith("blob:")) URL.revokeObjectURL(readImage.src);
        readImage.src = URL.createObjectURL(file);
        root.classList.add("has-picture");
        box.busy(true, "Reading");
        for (const card of readPart.querySelectorAll(".quire-qr-card")) card.remove();
        readMarks.replaceChildren();
        try {
            // the reading waits a frame, so the picture is seen first
            await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d", { willReadFrequently: true })!;
            context.drawImage(bitmap, 0, 0);
            const seen = readCodes(context.getImageData(0, 0, bitmap.width, bitmap.height));
            if (count !== readCount) return;
            found = seen;
        } finally {
            if (count === readCount) box.busy(false);
        }
        // top to bottom, then left to right, as they are read on a page
        const middleOf = (each: Found) => ({ x: each.corners.reduce((s, c) => s + c.x, 0) / 4, y: each.corners.reduce((s, c) => s + c.y, 0) / 4 });
        found.sort((a, b) => (Math.abs(middleOf(a).y - middleOf(b).y) > bitmap.height / 8 ? middleOf(a).y - middleOf(b).y : middleOf(a).x - middleOf(b).x));
        sayRead(found.length === 0 ? "No QR code found in this picture." : found.length === 1 ? "Found one code." : `Found ${found.length} codes.`);
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
            readPart.append(card(each, index));
        });
        fill();
    }

    /** What one code holds, as a group of the column: its kind for a heading, a row for each of its lines with copy beside it, then copy all and its facts. */
    function card(each: Found, index: number): HTMLElement {
        const said = describe(each.text);
        const title = lowered(said.title);
        const rows = said.lines.map((line) => {
            const value = make("span", said.link && line.value === said.link ? "quire-qr-value quire-qr-link" : "quire-qr-value", line.value);
            const copyOne = word(QR_WORDS.copyOne, () => void copyText(line.value, `Copied the ${lowered(line.label)}.`), true);
            copyOne.title = `Copy the ${lowered(line.label)}`;
            copyOne.setAttribute("aria-label", `Copy the ${lowered(line.label)}`);
            const made = widely(lowered(line.label), value, copyOne);
            made.classList.add("quire-qr-line");
            return made;
        });
        const copyAll = word(QR_WORDS.copyAll, () => void copyText(each.text, "Copied what the code holds."));
        copyAll.title = "Copy everything the code holds, as it is written";
        const facts = make("p", "quire-qr-card-facts", `Version ${each.read.version}, error correction ${LEVEL_WORDS.find((word) => word.level === each.read.level)!.label}${each.light ? ", light on dark" : ""}${each.read.mended ? `, ${each.read.mended} ${each.read.mended === 1 ? "byte" : "bytes"} mended` : ""}.`);
        const made = group(found.length > 1 ? `${index + 1}. ${title}` : title, ...rows, copyAll, facts);
        made.classList.add("quire-qr-card");
        made.style.setProperty("--delay", `${index * 60}ms`);
        return made;
    }
    async function copyText(value: string, words: string) {
        try {
            await navigator.clipboard.writeText(value);
            sayRead(words);
        } catch (error) {
            sayRead(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async function pasteFromMenu() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await read(await item.getType(type)));
            }
            setMode("read");
            sayRead("There is no picture on the clipboard.");
        } catch {
            setMode("read");
            sayRead("Press Ctrl+V to paste.");
        }
    }

    // ---- modes, kinds, and what is shown ----
    function setKind(next: Kind) {
        kind = next;
        fill();
        draw();
    }
    function setMode(next: "make" | "read") {
        if (next === mode) return fill();
        const from = parts.offsetHeight;
        mode = next;
        fill();
        sayLine();
        // the column's room goes from the height of the part that was shown to that of the part now shown
        const to = parts.offsetHeight;
        if (still() || from === to) return;
        parts.style.height = `${from}px`;
        void parts.offsetHeight;
        parts.style.height = `${to}px`;
        clearTimeout(settling);
        settling = setTimeout(() => (parts.style.height = ""), 400);
    }
    let settling: ReturnType<typeof setTimeout> | undefined;
    function fill() {
        root.classList.toggle("reading", mode === "read");
        makePart.inert = mode !== "make";
        readPart.inert = mode !== "read";
        modes.show(mode);
        kinds.show(kind);
        // what acts on a code waits for one, there and faint until then
        out.inert = sizes.group.inert = !shown;
        sizes.show(String(pngSize));
        for (const [each, form] of formOf) form.open(each === kind);
    }

    // ---- the four ways a picture comes to be read: paste, drop, choose, and paste from the menu or the phone's word ----
    const pictureIn = (data: DataTransfer | null) => [...(data?.files ?? [])].find((each) => each.type.startsWith("image/"));
    const typingIn = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("textarea, input:not([type=radio])");
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || typingIn(event.target)) return;
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
    square.addEventListener("contextmenu", (event) => {
        // Shift leaves the browser's own menu
        if (event.shiftKey) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
    });

    // ---- the keys ----
    const keys = (event: KeyboardEvent) => {
        // a round dot has the keyboard while it is chosen, and is not typed in, so the keys still reach the page from it
        const typing = typingIn(event.target);
        const command = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && document.activeElement === square) {
            event.preventDefault();
            const at = square.getBoundingClientRect();
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

    shapes.show(look.shape);
    eyes.show(look.eyes);
    paints.show(paintKind);
    angles.show(String(gradient.angle));
    flags.show(flag);
    pictures.show(pictureMode);
    levels.show(level);
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
            clearTimeout(readBackTimer);
            clearTimeout(settling);
            root.remove();
            anchor.remove();
        },
    };
}
