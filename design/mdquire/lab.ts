// The mdQuire lab's script (src/pages/mdquire-lab.astro). Every menu on the page opens the same way:
// the control that was pressed becomes the menu. A box is laid exactly over the control, in its
// shape, color and corners, and its edges are moved out to the menu's; what is inside the menu is
// laid out at its final place and held still while the edges pass over it, so nothing is stretched
// and the control's label stays where it was, as the menu's title. Closing runs the same way back,
// ending exactly on the control. The numbers that shape the motion come from the tuning panel.
//
// It is a lab: nothing here is imported by the editor (src/quire/), which may take what is chosen.

/** The numbers she can change, with the ones the page starts from. */
interface Settings {
    open: number;
    close: number;
    easing: "ease" | "spring" | "linear";
    bounce: number;
    lines: "together" | "stagger";
    stagger: number;
    radius: number;
    title: boolean;
    look: "outline" | "raised" | "quiet";
    slow: boolean;
}

const START: Settings = { open: 200, close: 140, easing: "spring", bounce: 0.14, lines: "stagger", stagger: 14, radius: 10, title: true, look: "outline", slow: false };
const settings: Settings = { ...START };

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** How far from the window's edge a menu keeps. */
const MARGIN = 8;
/** The site's own easing, --ease in tokens.css. */
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A spring that settles within its time, as a CSS linear() curve: no bounce at 0, a drop's bounce near 0.3. */
export function springCurve(bounce: number, points = 48): string {
    const damping = Math.max(0.25, 1 - bounce);
    const values: string[] = [];
    for (let step = 0; step <= points; step++) {
        const t = step / points;
        let x: number;
        if (damping >= 0.999) {
            const w = 9.23;
            x = 1 - (1 + w * t) * Math.exp(-w * t);
        } else {
            const w = 6.9 / damping;
            const wd = w * Math.sqrt(1 - damping * damping);
            x = 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
        }
        values.push((step === points ? 1 : x).toFixed(4));
    }
    return `linear(${values.join(", ")})`;
}

const times = () => (still.matches ? 0 : settings.slow ? 10 : 1);
const openTime = () => settings.open * times();
const closeTime = () => settings.close * times();
const openCurve = () => (settings.easing === "linear" ? "linear" : settings.easing === "spring" ? springCurve(settings.bounce) : EASE);
/** Closing draws back without springing: the bounce belongs to opening, as the picture viewer's does. */
const closeCurve = () => (settings.easing === "linear" ? "linear" : EASE);

// ---- what each menu holds ----

type Line = { label: string; mark?: string; icon?: string; swatch?: string; hint?: string; sub?: string; on?: boolean; pick?: string } | "rule";

const ICON: Record<string, string> = {
    bullet: '<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10"/>',
    number: '<path d="M4 5.5h1.5V10M4 10h3M4 14.5c0-1 .7-1.5 1.5-1.5s1.5.5 1.5 1.3c0 1.2-3 2.2-3 3.7h3"/><path d="M10.5 7h9M10.5 12h9M10.5 17h9"/>',
    task: '<rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="m4.6 16 1.4 1.4 2.6-2.8"/><path d="M11.5 7h8M11.5 16h8"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
    divider: '<path d="M4 12h16"/><path d="M8 7h8M8 17h8" opacity=".45"/>',
    code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    footnote: '<path d="M5 17h9M5 13h9M16 4v6M14 6l2-2"/>',
    outline: '<path d="M5 6h14M8 10h11M8 14h11M5 18h14"/>',
    left: '<path d="M5 6h14M5 10h9M5 14h14M5 18h9"/>',
    center: '<path d="M5 6h14M8 10h8M5 14h14M8 18h8"/>',
    right: '<path d="M5 6h14M10 10h9M5 14h14M10 18h9"/>',
    justify: '<path d="M5 6h14M5 10h14M5 14h14M5 18h14"/>',
    spacing: '<path d="M11 6h9M11 12h9M11 18h9"/><path d="m4 8 2-3 2 3M4 16l2 3 2-3M6 5v14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>',
    file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4"/>',
    shelf: '<rect x="4" y="4" width="6.5" height="8" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="8" rx="1.2"/><path d="M4 16h16M4 20h10"/>',
};

const MENUS: Record<string, Line[]> = {
    file: [{ label: "New document", icon: "file", hint: "Ctrl N" }, { label: "Open a file", hint: "Ctrl O" }, { label: "Open a folder" }, "rule", { label: "Save a copy" }, { label: "Download", sub: "export" }, "rule", { label: "Page setup" }, { label: "Print", hint: "Ctrl P" }],
    edit: [{ label: "Undo", icon: "undo", hint: "Ctrl Z" }, { label: "Redo", icon: "redo", hint: "Ctrl Shift Z" }, "rule", { label: "Cut", hint: "Ctrl X" }, { label: "Copy", hint: "Ctrl C" }, { label: "Paste", hint: "Ctrl V" }, { label: "Paste as plain text" }, "rule", { label: "Select all", hint: "Ctrl A" }, { label: "Find and replace", icon: "search", hint: "Ctrl F" }],
    view: [{ label: "Outline", icon: "outline" }, { label: "Page view" }, { label: "Focus on one paragraph" }, "rule", { label: "Zoom", sub: "zoomsub" }, { label: "Word count", on: true }],
    insert: [{ label: "Picture", icon: "image" }, { label: "Table", icon: "table" }, { label: "Link", icon: "link", hint: "Ctrl K" }, { label: "Divider", icon: "divider" }, { label: "Footnote", icon: "footnote" }, { label: "Code block", icon: "code" }, { label: "Today's date" }],
    format: [{ label: "Bold", mark: "B", hint: "Ctrl B" }, { label: "Italic", mark: "I", hint: "Ctrl I" }, { label: "Underline", mark: "U", hint: "Ctrl U" }, { label: "Strikethrough", mark: "S" }, "rule", { label: "Text size", mark: "Aa", sub: "size" }, { label: "Text color", swatch: "var(--accent)", sub: "color" }, { label: "Alignment", icon: "left", sub: "align" }, { label: "Line spacing", icon: "spacing", sub: "spacing" }, "rule", { label: "Clear formatting" }],
    tools: [{ label: "Word count" }, { label: "Spelling and prose" }, { label: "Dictation", hint: "Ctrl D" }, "rule", { label: "Preferences" }],
    document: [{ label: "Rename" }, { label: "Duplicate" }, { label: "All documents", icon: "shelf" }, "rule", { label: "Version history" }],
    paragraph: [{ label: "Paragraph", mark: "¶", pick: "label", on: true }, { label: "Heading 1", mark: "H1", pick: "label" }, { label: "Heading 2", mark: "H2", pick: "label" }, { label: "Heading 3", mark: "H3", pick: "label" }, { label: "Quote", mark: "”", pick: "label" }, { label: "Code", icon: "code", pick: "label" }],
    lists: [{ label: "Bulleted list", icon: "bullet" }, { label: "Numbered list", icon: "number" }, { label: "Tasks", icon: "task" }],
    add: [{ label: "Picture", icon: "image" }, { label: "Table", icon: "table" }, { label: "Divider", icon: "divider" }, { label: "Code block", icon: "code" }, { label: "Footnote", icon: "footnote" }],
    text: [{ label: "Text color", swatch: "var(--accent)", sub: "color" }, { label: "Text size", mark: "Aa", sub: "size" }, { label: "Highlight", swatch: "color-mix(in oklch, var(--accent) 40%, transparent)", sub: "highlight" }, { label: "Line spacing", icon: "spacing", sub: "spacing" }, "rule", { label: "Left", icon: "left", on: true }, { label: "Centre", icon: "center" }, { label: "Right", icon: "right" }, { label: "Justify", icon: "justify" }],
    more: [{ label: "Outline", icon: "outline" }, { label: "Page setup" }, { label: "Print", hint: "Ctrl P" }, { label: "Download", sub: "export" }, "rule", { label: "Keyboard shortcuts" }, { label: "About mdQuire" }],
    zoom: [{ label: "50%", pick: "label" }, { label: "75%", pick: "label" }, { label: "90%", pick: "label" }, { label: "100%", pick: "label", on: true }, { label: "125%", pick: "label" }, { label: "150%", pick: "label" }, { label: "200%", pick: "label" }, "rule", { label: "Fit to width" }],
    zoomsub: [{ label: "Zoom in", hint: "Ctrl +" }, { label: "Zoom out", hint: "Ctrl -" }, { label: "Actual size", hint: "Ctrl 0" }],
    size: [{ label: "Small" }, { label: "Normal", on: true }, { label: "Large" }, { label: "Larger" }, { label: "Huge" }],
    color: [{ label: "Ink", swatch: "var(--ink)", on: true }, { label: "Muted", swatch: "var(--muted)" }, { label: "Violet", swatch: "oklch(0.77 0.16 300)" }, { label: "Pink", swatch: "oklch(0.78 0.15 350)" }, { label: "Blue", swatch: "oklch(0.78 0.12 250)" }, { label: "Mint", swatch: "oklch(0.84 0.12 165)" }, { label: "Amber", swatch: "oklch(0.84 0.13 80)" }],
    highlight: [{ label: "None", on: true }, { label: "Violet", swatch: "oklch(0.77 0.16 300 / 0.4)" }, { label: "Pink", swatch: "oklch(0.78 0.15 350 / 0.4)" }, { label: "Mint", swatch: "oklch(0.84 0.12 165 / 0.4)" }, { label: "Amber", swatch: "oklch(0.84 0.13 80 / 0.4)" }],
    align: [{ label: "Left", icon: "left", on: true }, { label: "Centre", icon: "center" }, { label: "Right", icon: "right" }, { label: "Justify", icon: "justify" }],
    spacing: [{ label: "Single" }, { label: "1.15" }, { label: "1.5", on: true }, { label: "Double" }],
    export: [{ label: "Markdown" }, { label: "HTML" }, { label: "PDF" }, { label: "Plain text" }],
};

// ---- the box that is the control, stretched ----

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** One open menu: the control it grew from, the box, and what is inside it. */
interface Open {
    id: string;
    trigger: HTMLElement;
    box: HTMLDivElement;
    body: HTMLDivElement;
    title: HTMLElement | undefined;
    lines: HTMLButtonElement[];
    final: Box;
    up: boolean;
    row: boolean;
    parent: Open | undefined;
    child: Open | undefined;
    closing: boolean;
    moving: Animation[];
}

/** When a menu was last opened, so that the page settling as it opens does not count as a scroll that closes it. */
let openedAt = 0;

/** Open menus, the first from a control on the page and each after it a submenu of the one before. */
const stack: Open[] = [];

const boxOf = (element: Element): Box => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name = "", text = ""): HTMLElementTagNameMap[K] => {
    const made = document.createElement(tag);
    if (name) made.className = name;
    if (text) made.textContent = text;
    return made;
};

/** How a control looks at rest: its corners, its ground and its edge, which the box starts and ends as. */
function lookOf(trigger: HTMLElement): { radius: string; ground: string; edge: string; color: string } {
    const style = getComputedStyle(trigger);
    const edged = Number.parseFloat(style.borderTopWidth) > 0;
    return { radius: style.borderTopLeftRadius, ground: style.backgroundColor, edge: edged ? style.borderTopColor : "transparent", color: style.color };
}

function linesFor(id: string, open: () => Open | undefined): HTMLButtonElement[] {
    return (MENUS[id] ?? []).flatMap((line) => {
        if (line === "rule") return [make("div", "lab-rule") as unknown as HTMLButtonElement];
        const button = make("button", "lab-line");
        button.type = "button";
        button.tabIndex = -1;
        button.setAttribute("role", line.pick ? "menuitemradio" : "menuitem");
        if (line.on) button.classList.add("is-on");
        if (line.pick) button.setAttribute("aria-checked", String(Boolean(line.on)));
        const mark = make("span", "lab-line-mark");
        if (line.icon) mark.innerHTML = `<svg class="lab-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[line.icon] ?? ""}</svg>`;
        else if (line.swatch) {
            const swatch = make("span", "lab-swatch");
            swatch.style.background = line.swatch;
            mark.append(swatch);
        } else if (line.mark) {
            mark.textContent = line.mark;
            if (/^H\d$/.test(line.mark)) mark.classList.add("lab-h");
            if (line.mark === "B") mark.style.fontWeight = "750";
            if (line.mark === "I") mark.style.fontStyle = "italic";
            if (line.mark === "U") mark.style.textDecoration = "underline";
            if (line.mark === "S") mark.style.textDecoration = "line-through";
        }
        button.append(mark, make("span", "lab-line-label", line.label));
        if (line.hint || line.sub) button.append(make("span", "lab-line-hint", line.sub ? "›" : (line.hint ?? "")));
        if (line.sub) {
            button.setAttribute("aria-haspopup", "menu");
            button.dataset.sub = line.sub;
        }
        button.addEventListener("click", () => choose(open(), button, line));
        return [button];
    });
}

/** Builds and places the menu `id` over `trigger`, or as a submenu beside `parent`, and lets it grow. */
function openMenu(trigger: HTMLElement, id: string, parent?: Open, focus?: "first" | "last"): Open {
    const sub = Boolean(parent);
    // a control scrolled out of sight along a narrow bar is brought into it first
    if (!sub) {
        openedAt = performance.now();
        trigger.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const titled = settings.title && !sub;
    const from = boxOf(trigger);
    const rest = lookOf(trigger);
    const row = trigger.classList.contains("lab-menu-word");

    const box = make("div", `lab-morph lab-look-${settings.look}`);
    box.setAttribute("role", "menu");
    box.setAttribute("aria-label", trigger.getAttribute("aria-label") ?? trigger.textContent?.trim() ?? id);
    box.tabIndex = -1;
    box.style.setProperty("--menu-radius", `${settings.radius}px`);
    const body = make("div", "lab-morph-body");
    const holder = make("div", "lab-lines");
    let open: Open | undefined;
    const lines = linesFor(id, () => open);
    holder.append(...lines);
    let title: HTMLElement | undefined;
    if (!sub) {
        // the title is the control drawn again: the same classes, the same insides, the same color
        title = make("div", `${trigger.className.replace(/\bis-open\b/, "")} lab-morph-title`);
        title.innerHTML = trigger.innerHTML;
        title.removeAttribute("tabindex");
        title.setAttribute("aria-hidden", "true");
        title.style.color = rest.color;
        Object.assign(title.style, { width: `${from.width}px`, height: `${from.height}px` });
        body.append(title);
    }
    body.append(holder);
    box.append(body);
    box.style.visibility = "hidden";
    document.body.append(box);

    // the menu's own size, then where it goes: below or above, rightward or leftward, as there is room
    holder.style.width = "max-content";
    const natural = boxOf(holder);
    const width = Math.min(Math.max(natural.width, sub ? 0 : from.width), innerWidth - MARGIN * 2);
    const head = titled ? from.height : 0;
    let height = natural.height + head;
    let left: number;
    let top: number;
    let up = false;
    if (parent) {
        const beside = parent.final;
        const room = innerWidth - MARGIN - (beside.left + beside.width);
        left = room >= width + 4 ? beside.left + beside.width + 4 : beside.left - width - 4;
        left = Math.min(Math.max(left, MARGIN), innerWidth - MARGIN - width);
        height = Math.min(height, innerHeight - MARGIN * 2);
        top = Math.min(Math.max(from.top - 5.6, MARGIN), innerHeight - MARGIN - height);
    } else {
        const below = innerHeight - MARGIN - from.top;
        const above = from.top + from.height - MARGIN;
        up = below < height && above > below;
        height = Math.min(height, up ? above : below);
        top = up ? from.top + from.height - height : from.top;
        left = from.left + width <= innerWidth - MARGIN ? from.left : from.left + from.width - width;
        left = Math.min(Math.max(left, MARGIN), innerWidth - MARGIN - width);
    }
    const final: Box = { left, top, width, height };
    holder.style.width = "100%";
    holder.style.maxHeight = `${height - head}px`;
    holder.style.overflowY = natural.height + head > height ? "auto" : "";
    holder.style.top = up ? "0px" : `${head}px`;
    if (title) Object.assign(title.style, { left: `${from.left - left}px`, top: `${from.top - top}px` });
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    Object.assign(body.style, { width: `${width}px`, height: `${height}px` });
    const end = getComputedStyle(box);
    const ground = end.backgroundColor;
    const edge = end.borderTopColor;
    const shadow = end.boxShadow;
    const start = sub ? lookOf(trigger) : rest;

    open = { id, trigger, box, body, title, lines: lines.filter((line) => line.classList.contains("lab-line")), final, up, row, parent, child: undefined, closing: false, moving: [] };
    if (parent) parent.child = open;
    else stack.length = 0;
    stack.push(open);

    trigger.setAttribute("aria-expanded", "true");
    if (!sub) trigger.classList.add("is-open");
    else trigger.classList.add("is-near");
    box.style.visibility = "";
    grow(open, from, start, ground, edge, shadow);
    if (focus) (focus === "first" ? open.lines[0] : open.lines.at(-1))?.focus({ preventScroll: true });
    else box.focus({ preventScroll: true });
    return open;
}

/** The edges move from `from` to the menu's place while what is inside stays where it will end. */
function grow(open: Open, from: Box, start: { radius: string; ground: string; edge: string }, ground: string, edge: string, shadow: string): void {
    const { final, box, body, title } = open;
    const time = openTime();
    const curve = openCurve();
    open.moving = [
        box.animate(
            [
                { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: start.radius, backgroundColor: start.ground, borderColor: start.edge, boxShadow: quiet(shadow) },
                { left: `${final.left}px`, top: `${final.top}px`, width: `${final.width}px`, height: `${final.height}px`, borderRadius: `${settings.radius}px`, backgroundColor: ground, borderColor: edge, boxShadow: shadow },
            ],
            { duration: time, easing: curve, fill: "both" },
        ),
        body.animate([{ translate: `${final.left - from.left}px ${final.top - from.top}px` }, { translate: "0px 0px" }], { duration: time, easing: curve, fill: "both" }),
    ];
    open.lines.forEach((line, index) => {
        const order = open.up ? open.lines.length - 1 - index : index;
        const delay = time * 0.2 + (settings.lines === "stagger" ? order * settings.stagger * times() : 0);
        line.animate([{ opacity: 0, translate: `0 ${open.up ? 4 : -4}px` }, { opacity: 1, translate: "0 0" }], { duration: Math.max(time * 0.75, still.matches ? 0 : 90 * times()), delay, easing: EASE, fill: "both" });
    });
    if (title && !settings.title) title.animate([{ opacity: 1 }, { opacity: 0 }], { duration: time * 0.4, fill: "both" });
    // the three dots run together into a cross, on the same clock as the box
    const dots = [...(title?.querySelectorAll<HTMLElement>(".lab-dots-in i") ?? [])];
    dots.forEach((dot, index) => open.moving.push(dot.animate([DOTS[index]!, CROSS[index]!], { duration: time, easing: EASE, fill: "both" })));
}

/** The three dots at rest, and as a cross. */
const DOTS: Keyframe[] = [
    { translate: "-0.45rem 0", rotate: "0deg", width: "0.28rem", height: "0.28rem", opacity: 1 },
    { translate: "0 0", rotate: "0deg", width: "0.28rem", height: "0.28rem", opacity: 1 },
    { translate: "0.45rem 0", rotate: "0deg", width: "0.28rem", height: "0.28rem", opacity: 1 },
];
const CROSS: Keyframe[] = [
    { translate: "0 0", rotate: "45deg", width: "1rem", height: "0.13rem", opacity: 1 },
    { translate: "0 0", rotate: "0deg", width: "0.28rem", height: "0.28rem", opacity: 0 },
    { translate: "0 0", rotate: "-45deg", width: "1rem", height: "0.13rem", opacity: 1 },
];

/** A shadow with its size and color taken away, for the box to grow its shadow from. */
const quiet = (shadow: string) => (shadow === "none" ? "none" : shadow.replace(/oklch\([^)]*\)|rgba?\([^)]*\)/g, "transparent"));

/** What the box is drawn as at this moment, read before its motion is stopped. */
function now(box: HTMLElement): { place: Box; radius: string; ground: string; edge: string; shadow: string } {
    const style = getComputedStyle(box);
    return { place: boxOf(box), radius: style.borderTopLeftRadius, ground: style.backgroundColor, edge: style.borderTopColor, shadow: style.boxShadow };
}

/** Closes a menu and the ones opened from it, drawing it back onto its control. */
function closeMenu(open: Open, focusBack = false): Promise<void> {
    if (open.child) void closeMenu(open.child);
    if (open.closing) return Promise.resolve();
    open.closing = true;
    const at = stack.indexOf(open);
    if (at >= 0) stack.splice(at);
    if (open.parent) open.parent.child = undefined;
    const { box, body, trigger, title, final } = open;
    const was = now(box);
    const translate = getComputedStyle(body).translate;
    const crossed = [...(title?.querySelectorAll<HTMLElement>(".lab-dots-in i") ?? [])].map((dot) => {
        const style = getComputedStyle(dot);
        return { translate: style.translate, rotate: style.rotate, width: style.width, height: style.height, opacity: style.opacity };
    });
    for (const moving of open.moving) moving.cancel();
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-near");
    // the control as it will be drawn once the box has gone, measured with its own drawing back
    trigger.classList.remove("is-open");
    const back = boxOf(trigger);
    const rest = lookOf(trigger);
    if (!open.parent) trigger.classList.add("is-open");
    const time = closeTime();
    const curve = closeCurve();
    const shrink = box.animate(
        [
            { left: `${was.place.left}px`, top: `${was.place.top}px`, width: `${was.place.width}px`, height: `${was.place.height}px`, borderRadius: was.radius, backgroundColor: was.ground, borderColor: was.edge, boxShadow: was.shadow },
            { left: `${back.left}px`, top: `${back.top}px`, width: `${back.width}px`, height: `${back.height}px`, borderRadius: rest.radius, backgroundColor: rest.ground, borderColor: rest.edge, boxShadow: quiet(was.shadow) },
        ],
        { duration: time, easing: curve, fill: "both" },
    );
    body.animate([{ translate: translate === "none" ? "0px 0px" : translate }, { translate: `${final.left - back.left}px ${final.top - back.top}px` }], { duration: time, easing: curve, fill: "both" });
    for (const line of open.lines) line.animate([{ opacity: getComputedStyle(line).opacity }, { opacity: 0 }], { duration: time * 0.5, fill: "both" });
    if (title) {
        title.getAnimations().forEach((moving) => moving.cancel());
        if (!settings.title) title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: time, easing: "ease-in", fill: "both" });
        title.querySelectorAll<HTMLElement>(".lab-dots-in i").forEach((dot, index) => {
            if (crossed[index]) dot.animate([crossed[index], DOTS[index]!], { duration: time, easing: curve, fill: "both" });
        });
    }
    // a submenu whose menu is going too simply fades with it
    if (open.parent?.closing) box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: time * 0.6, fill: "both" });
    if (focusBack) trigger.focus({ preventScroll: true });
    open.moving = [shrink];
    lab.lastClose = { box, trigger, shrink, back };
    return shrink.finished.then(
        () => finish(open),
        () => finish(open),
    );
}

function finish(open: Open): void {
    open.box.remove();
    if (!stack.some((other) => other.trigger === open.trigger)) open.trigger.classList.remove("is-open");
}

/** Closes everything open. */
function closeAll(focusBack = false): void {
    const root = stack[0];
    if (root) void closeMenu(root, focusBack);
}

/** Moving along the row of menu words with a menu open, the open menu slides to the next word and becomes its menu. */
function slide(open: Open, trigger: HTMLElement, id: string, focus?: "first"): void {
    if (open.child) void closeMenu(open.child);
    const was = now(open.box);
    const oldBody = open.body;
    const oldTranslate = getComputedStyle(oldBody).translate;
    for (const moving of open.moving) moving.cancel();
    oldBody.getAnimations().forEach((moving) => moving.cancel());
    open.trigger.classList.remove("is-open");
    open.trigger.setAttribute("aria-expanded", "false");
    // the new menu is built as if opened fresh, then its box is taken over by this one
    const fresh = openMenu(trigger, id);
    fresh.moving.forEach((moving) => moving.cancel());
    fresh.body.getAnimations().forEach((moving) => moving.cancel());
    fresh.lines.forEach((line) => line.getAnimations().forEach((moving) => moving.cancel()));
    fresh.title?.getAnimations().forEach((moving) => moving.cancel());
    trigger.classList.remove("is-open");
    const time = openTime();
    const curve = EASE;
    const { final } = fresh;
    fresh.box.append(oldBody);
    open.box.remove();
    fresh.moving = [
        fresh.box.animate(
            [
                { left: `${was.place.left}px`, top: `${was.place.top}px`, width: `${was.place.width}px`, height: `${was.place.height}px`, borderRadius: was.radius },
                { left: `${final.left}px`, top: `${final.top}px`, width: `${final.width}px`, height: `${final.height}px`, borderRadius: `${settings.radius}px` },
            ],
            { duration: time, easing: curve, fill: "both" },
        ),
        fresh.body.animate([{ translate: `${final.left - was.place.left}px ${final.top - was.place.top}px`, opacity: 0 }, { translate: "0px 0px", opacity: 1 }], { duration: time, easing: curve, fill: "both" }),
    ];
    const start = oldTranslate === "none" ? [0, 0] : oldTranslate.split(" ").map((part) => Number.parseFloat(part) || 0);
    const leaving = oldBody.animate(
        [
            { translate: `${start[0]}px ${start[1] ?? 0}px`, opacity: 1 },
            { translate: `${(start[0] ?? 0) + was.place.left - final.left}px ${(start[1] ?? 0) + was.place.top - final.top}px`, opacity: 0 },
        ],
        { duration: time * 0.6, easing: curve, fill: "both" },
    );
    void leaving.finished.then(() => oldBody.remove(), () => oldBody.remove());
    void fresh.moving[0]?.finished.then(() => {
        if (stack.includes(fresh) && !fresh.closing) trigger.classList.add("is-open");
    }, () => {});
    if (focus) fresh.lines[0]?.focus({ preventScroll: true });
}

/** A line of a menu was chosen. */
function choose(open: Open | undefined, line: HTMLButtonElement, spec: Exclude<Line, "rule">): void {
    if (!open) return;
    if (spec.sub) {
        if (open.child?.trigger === line) return;
        if (open.child) void closeMenu(open.child);
        openMenu(line, spec.sub, open, "first");
        return;
    }
    if (spec.pick) {
        for (const other of open.lines) {
            other.classList.toggle("is-on", other === line);
            other.setAttribute("aria-checked", String(other === line));
        }
        const root = stack[0];
        const label = root?.trigger.querySelector(".lab-label");
        if (label && root === open) label.textContent = spec.label;
        const shown = root?.title?.querySelector(".lab-label");
        if (shown && root === open) shown.textContent = spec.label;
        for (const item of MENUS[open.id] ?? []) if (item !== "rule") item.on = item.label === spec.label;
    }
    closeAll(true);
}

// ---- the controls that open menus ----

const triggers = [...document.querySelectorAll<HTMLElement>("[data-menu]")];
const rowWords = triggers.filter((trigger) => trigger.classList.contains("lab-menu-word"));

for (const trigger of triggers) {
    const id = trigger.dataset.menu ?? "";
    trigger.addEventListener("mousedown", (event) => event.preventDefault());
    trigger.addEventListener("click", (event) => {
        const root = stack[0];
        if (root && root.trigger === trigger && !root.closing) return void closeMenu(root);
        if (root && root.row && trigger.classList.contains("lab-menu-word") && !root.closing) return slide(root, trigger, id);
        if (root) void closeMenu(root);
        openMenu(trigger, id, undefined, event.detail === 0 ? "first" : undefined);
    });
    trigger.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || (event.key === "ArrowUp" && !trigger.closest(".lab-bar, .lab-menus"))) {
            event.preventDefault();
            if (stack[0]) void closeMenu(stack[0]);
            openMenu(trigger, id, undefined, event.key === "ArrowDown" ? "first" : "last");
        }
    });
}

// A menu open from the row follows the pointer along it. The open menu's title band lies over the
// words beside its own, so the words are found by where they are, not by what is on top.
document.addEventListener("pointermove", (event) => {
    const root = stack[0];
    if (!root || !root.row || root.closing) return;
    const word = rowWords.find((each) => {
        const { left, right, top, bottom } = each.getBoundingClientRect();
        return event.clientX >= left && event.clientX < right && event.clientY >= top && event.clientY < bottom;
    });
    if (word && word !== root.trigger) slide(root, word, word.dataset.menu ?? "");
});

// the arrow keys move along the row of words and along the bar, one stop each
for (const strip of document.querySelectorAll<HTMLElement>(".lab-menus, .lab-bar")) {
    const stops = () => [...strip.querySelectorAll<HTMLElement>("button")];
    strip.addEventListener("keydown", (event) => {
        if (stack.length) return;
        const all = stops();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        const to = all[(next + all.length) % all.length];
        for (const stop of all) stop.tabIndex = stop === to ? 0 : -1;
        to?.focus();
    });
}

// ---- keys inside a menu ----

let typed = "";
let typedAt = 0;

document.addEventListener(
    "keydown",
    (event) => {
        const open = stack.at(-1);
        if (!open || open.closing) return;
        const lines = open.lines;
        const at = lines.indexOf(document.activeElement as HTMLButtonElement);
        const go = (index: number) => lines[(index + lines.length) % lines.length]?.focus({ preventScroll: true });
        const root = stack[0];
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                return go(at + 1);
            case "ArrowUp":
                event.preventDefault();
                return go(at < 0 ? -1 : at - 1);
            case "Home":
                event.preventDefault();
                return go(0);
            case "End":
                event.preventDefault();
                return go(-1);
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                if (open.parent) {
                    const line = open.trigger;
                    void closeMenu(open);
                    return line.focus({ preventScroll: true });
                }
                return void closeMenu(open, true);
            case "Tab": {
                // Tab goes round the open menu's lines and nowhere else
                event.preventDefault();
                return go(at + (event.shiftKey ? -1 : 1));
            }
            case "ArrowRight": {
                event.preventDefault();
                const line = lines[at];
                if (line?.dataset.sub) return line.click();
                if (root?.row) {
                    const index = rowWords.indexOf(root.trigger);
                    const next = rowWords[(index + 1) % rowWords.length]!;
                    return slide(root, next, next.dataset.menu ?? "", "first");
                }
                return;
            }
            case "ArrowLeft": {
                event.preventDefault();
                if (open.parent) {
                    const line = open.trigger;
                    void closeMenu(open);
                    return line.focus({ preventScroll: true });
                }
                if (root?.row) {
                    const index = rowWords.indexOf(root.trigger);
                    const next = rowWords[(index - 1 + rowWords.length) % rowWords.length]!;
                    return slide(root, next, next.dataset.menu ?? "", "first");
                }
                return;
            }
        }
        // a letter goes to the next line whose words start with what has been typed
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
            event.preventDefault();
            typed = performance.now() - typedAt > 700 ? event.key : typed + event.key;
            typedAt = performance.now();
            const wanted = typed.toLowerCase();
            const start = wanted.length === 1 ? at + 1 : Math.max(at, 0);
            for (let step = 0; step < lines.length; step++) {
                const index = (start + step) % lines.length;
                if (lines[index]?.querySelector(".lab-line-label")?.textContent?.toLowerCase().startsWith(wanted)) return go(index);
            }
        }
    },
    true,
);

// pointing at a line with a submenu opens it after a moment; pointing at another line closes it
let hoverWait = 0;
document.addEventListener("pointerover", (event) => {
    const line = (event.target as Element).closest?.(".lab-line");
    if (!(line instanceof HTMLButtonElement)) return;
    const open = stack.find((menu) => menu.lines.includes(line));
    if (!open || open.closing) return;
    clearTimeout(hoverWait);
    hoverWait = window.setTimeout(() => {
        if (open.child && open.child.trigger !== line) void closeMenu(open.child);
        if (line.dataset.sub && open.child?.trigger !== line && !open.closing) openMenu(line, line.dataset.sub, open);
    }, 140);
});

// a press anywhere outside the open menus, and outside the control they came from, closes them
document.addEventListener(
    "pointerdown",
    (event) => {
        const root = stack[0];
        if (!root) return;
        const target = event.target as Node;
        if (stack.some((open) => open.box.contains(target)) || root.trigger.contains(target)) return;
        if (target instanceof Element && target.closest(".lab-menu-word") && root.row) return;
        closeAll();
    },
    true,
);

addEventListener("scroll", () => performance.now() - openedAt > 200 && closeAll(), { passive: true });
addEventListener("resize", () => {
    for (const open of [...stack].reverse()) open.box.remove();
    for (const open of stack) open.trigger.classList.remove("is-open", "is-near");
    stack.length = 0;
});

// ---- the bar's own buttons ----

for (const toggle of document.querySelectorAll<HTMLButtonElement>("[data-toggle], .lab-mic")) {
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => toggle.setAttribute("aria-pressed", String(toggle.getAttribute("aria-pressed") !== "true")));
}

// ---- the tuning panel ----

const panel = document.querySelector<HTMLElement>(".lab-tune")!;
const head = panel.querySelector<HTMLButtonElement>(".lab-tune-head")!;
const out = panel.querySelector<HTMLTextAreaElement>(".lab-out")!;
const fold = (folded: boolean) => {
    panel.classList.toggle("folded", folded);
    head.setAttribute("aria-expanded", String(!folded));
    panel.querySelector<HTMLElement>(".lab-tune-inner")!.inert = folded;
};
head.addEventListener("click", () => fold(!panel.classList.contains("folded")));
fold(innerWidth < 1250);

const shown: Record<string, (value: number) => string> = {
    open: (value) => `${value} ms`,
    close: (value) => `${value} ms`,
    bounce: (value) => value.toFixed(2),
    stagger: (value) => `${value} ms`,
    radius: (value) => `${value} px`,
};

function fill(): void {
    for (const input of panel.querySelectorAll<HTMLInputElement>("input")) {
        const name = input.name as keyof Settings;
        const value = settings[name];
        if (input.type === "range") {
            input.value = String(value);
            const output = input.parentElement?.querySelector("output");
            if (output) output.textContent = shown[name]?.(Number(value)) ?? String(value);
        } else if (input.type === "radio") input.checked = input.value === value;
        else if (input.type === "checkbox") input.checked = Boolean(value);
    }
    panel.querySelector<HTMLInputElement>('input[name="bounce"]')!.disabled = settings.easing !== "spring";
    panel.querySelector<HTMLInputElement>('input[name="stagger"]')!.disabled = settings.lines !== "stagger";
    out.value = written();
}

function written(): string {
    const curve = settings.easing === "spring" ? `spring, bounce ${settings.bounce.toFixed(2)}` : settings.easing === "ease" ? "the site's --ease" : "linear";
    const arrive = settings.lines === "stagger" ? `one after another, ${settings.stagger} ms apart` : "together";
    return [
        "mdQuire menus, as tuned in the lab",
        `open: ${settings.open} ms`,
        `close: ${settings.close} ms`,
        `easing: ${curve}`,
        `lines arrive: ${arrive}`,
        `corners of the open menu: ${settings.radius} px`,
        `label stays as the title: ${settings.title ? "yes" : "no"}`,
        `look: ${settings.look}`,
    ].join("\n");
}

panel.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const name = input.name as keyof Settings;
    if (!(name in settings)) return;
    const value = input.type === "range" ? Number(input.value) : input.type === "checkbox" ? input.checked : input.value;
    (settings as unknown as Record<string, unknown>)[name] = value;
    fill();
});

panel.querySelector(".lab-copy")!.addEventListener("click", () => {
    out.value = written();
    out.select();
    void navigator.clipboard?.writeText(out.value).catch(() => {});
});
panel.querySelector(".lab-reset")!.addEventListener("click", () => {
    Object.assign(settings, START);
    fill();
});
fill();

// ---- for the checks run on this page in a headless browser ----

const lab = {
    settings,
    stack,
    lastClose: undefined as undefined | { box: HTMLElement; trigger: HTMLElement; shrink: Animation; back: Box },
    open: (id: string) => {
        const trigger = triggers.find((each) => each.dataset.menu === id);
        if (trigger) trigger.click();
        return stack[0];
    },
    closeAll,
};
(window as unknown as { lab: typeof lab }).lab = lab;
