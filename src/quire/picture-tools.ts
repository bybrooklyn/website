// What a person does to a picture in the text. Pressed, a picture is picked: a frame with a handle
// at each corner grows round it, and a small strip above it sets its alignment, puts it back to its
// own size, opens its menu or takes it away. Dragging a corner resizes it, keeping its shape, drawn
// gently to the text's full width, half and a third (pictures.ts counts that); the frame says which.
// Dragging the picture itself lifts it; the text opens, with a line, where it will land between any
// two blocks, in and out of lists and quotes too, and letting go puts it there. Each change is one
// undo step. Pasting or dropping picture files is the surface's (surface.ts).
//
// Nothing stands under a picture but its caption, once it has words. Right-clicking it, the
// keyboard's menu key, or the strip's three dots open its menu at the pointer: caption, description,
// alignment, size, text flowing round it, replacing it and taking it away. The first four open a
// panel at the right, quiet labelled lines as the document's own facts there are (details.ts), where
// they are written and chosen. It grows out of the line pressed and goes back into the picture.
//
// Only a picture standing as a block of its own is picked; one inside a line of text is not.
//
//   const pictures = createPictureTools(surface, { keep, margin });   // pictures.destroy()

import { insetOf, DIALOG } from "./dialog";
import { blockAt, removeBlock, setAlign, setImage, type Align, type Image } from "./document";
import { landedAt, landings, moveBlockTo, snapWidth, staysPut } from "./pictures";
import type { Operation, Surface } from "./surface";
import { control, dots, EASE, flowMenu, icon, make, MOTION, springCurve, still, type Box, type MenuItem } from "./ui";

/** Draws a picture block for the surface: the picture at its width, and its caption under it when it has one. */
export function drawPicture(block: Image, inner: number[]): HTMLElement {
    const figure = make("figure", "quire-image");
    figure.contentEditable = "false";
    figure.tabIndex = -1;
    figure.dataset.picture = inner.join(",");
    if (block.align) {
        figure.style.textAlign = block.align;
        figure.dataset.align = block.align;
    }
    // a picture the text flows round floats at its side, its width the float's, and no wider than half the text when it has none
    if (block.wrap) figure.dataset.wrap = block.align === "right" ? "right" : "left";
    if (block.wrap && block.width === undefined) figure.style.maxWidth = "50%";
    const picture = make("img");
    picture.src = block.src;
    picture.alt = block.alt;
    picture.draggable = false;
    if (block.width !== undefined) (block.wrap ? figure : picture).style.width = `${block.width}%`;
    figure.append(picture);
    if (block.caption) figure.append(make("figcaption", "quire-caption", block.caption));
    return figure;
}

/** The handles, by the corner each is at. */
const CORNERS = ["nw", "ne", "sw", "se"] as const;

/** The ways a picture can sit, with their names. */
const SIDES: [Align, string][] = [
    ["left", "Picture to the left"],
    ["center", "Picture in the centre"],
    ["right", "Picture to the right"],
];

/** The sizes the panel offers, by name; undefined is the picture's own. */
const SIZES: [string, number | undefined][] = [
    ["Own size", undefined],
    ["Full", 100],
    ["Half", 50],
    ["A third", 33],
];

const boxOf = (element: Element): Box => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
};

/** What the host gives: where a new picture's file is kept (giving its address), and the element the panel stands in. */
export interface PictureOptions {
    keep?: (file: File) => Promise<string>;
    margin?: HTMLElement;
}

/** Builds the picture tools for a surface. */
export function createPictureTools(surface: Surface, options: PictureOptions = {}) {
    const root = surface.element;
    // a press on a picture picks it here; the site's picture viewer (src/scripts/viewer.ts), which opens on any picture in prose, is told to leave these alone
    root.dataset.noView = "";
    let picked: number[] | undefined;
    /** Runs a change to the picked picture as one undo step. */
    const change = (operation: (path: number[]) => Operation) => picked && surface.run(operation(picked));

    // ---- the frame round a picked picture, with its handles and its strip ----
    const frame = make("div", "quire-frame");
    frame.contentEditable = "false";
    for (const corner of CORNERS) {
        const handle = make("span", "quire-handle");
        handle.dataset.corner = corner;
        frame.append(handle);
    }
    const label = make("span", "quire-frame-label");
    const strip = make("div", "quire-picture-strip");
    strip.setAttribute("role", "toolbar");
    strip.setAttribute("aria-label", "Picture");
    const aligns = new Map<Align, HTMLButtonElement>();
    const sitAt = (align: Align) => change((path) => (doc) => setAlign(doc, path, align === "left" ? null : align));
    for (const [align, words] of SIDES) {
        const button = control(words, icon(align), () => sitAt(align));
        aligns.set(align, button);
        strip.append(button);
    }
    const own = control("Its own size", "Own size", () => change((path) => (doc) => setImage(doc, path, { width: undefined })), "quire-button quire-own-size");
    const more = dots("More for this picture");
    more.addEventListener("click", () => (menu.isOpen() ? menu.close(true) : openMenu(more)));
    strip.append(make("span", "quire-select-rule"), own, more);
    frame.append(label, strip);

    const figureAt = (path: number[]): HTMLElement | undefined => {
        const top = root.children[path[0]!] as HTMLElement | undefined;
        if (!top) return undefined;
        const inner = path.slice(1).join(",");
        return top.matches("figure.quire-image") && top.dataset.picture === inner ? top : (top.querySelector<HTMLElement>(`figure.quire-image[data-picture="${inner}"]`) ?? undefined);
    };
    const pathOf = (figure: HTMLElement): number[] => {
        let top: Element = figure;
        while (top.parentElement && top.parentElement !== root) top = top.parentElement;
        const inner = figure.dataset.picture ? figure.dataset.picture.split(",").map(Number) : [];
        return [[...root.children].indexOf(top), ...inner];
    };
    const pictureOf = (path: number[]) => {
        const block = blockAt(surface.getDocument(), path);
        return block?.kind === "image" ? block : undefined;
    };

    /** Puts the frame over the picture as it is drawn now, and the strip's and panel's buttons as the picture stands. */
    function place() {
        const figure = picked && figureAt(picked);
        const picture = figure?.querySelector("img");
        const block = picked && pictureOf(picked);
        if (!figure || !picture || !block) return;
        // a picture still loading has no size yet: the frame is put on it once it has
        if (!picture.complete) picture.addEventListener("load", place, { once: true });
        if (frame.parentElement !== figure) figure.append(frame);
        Object.assign(frame.style, { left: `${picture.offsetLeft}px`, top: `${picture.offsetTop}px`, width: `${picture.offsetWidth}px`, height: `${picture.offsetHeight}px` });
        const pressed = (button: HTMLElement, on: boolean) => {
            button.classList.toggle("pressed", on);
            button.setAttribute("aria-pressed", String(on));
        };
        for (const [align, button] of aligns) pressed(button, (block.align ?? "left") === align);
        for (const [align, button] of sides) pressed(button, (block.align ?? "left") === align);
        for (const [width, button] of sizes) pressed(button, block.width === width);
        pressed(wrap, !!block.wrap);
        wrap.textContent = block.wrap ? "On" : "Off";
        wrap.disabled = block.align === "center";
        // a field being written in is left as it is
        if (document.activeElement !== caption) caption.value = block.caption ?? "";
        if (document.activeElement !== described) described.value = block.alt;
        own.classList.toggle("absent", block.width === undefined);
        own.tabIndex = block.width === undefined ? -1 : 0;
        // the strip goes under the picture when there is no room above it in the window, and starts at its left edge when a narrow picture would push it out of the window
        frame.classList.toggle("low", picture.getBoundingClientRect().top < 120);
        frame.classList.remove("start");
        frame.classList.toggle("start", strip.getBoundingClientRect().left < 8);
    }

    /** Picks a picture: the frame grows round it. */
    function pick(path: number[]) {
        const figure = figureAt(path);
        if (!figure) return;
        if (picked && (picked.length !== path.length || picked.some((step, k) => step !== path[k]))) figureAt(picked)?.classList.remove("quire-picked");
        picked = path;
        figure.classList.add("quire-picked");
        const fresh = !frame.classList.contains("shown");
        place();
        if (fresh) requestAnimationFrame(() => picked && frame.classList.add("shown"));
    }

    /** Lets the picked picture go: the frame shrinks away into it, and the menu and panel go with it. */
    function unpick() {
        if (!picked) return;
        menu.close(false);
        closePanel(false);
        figureAt(picked)?.classList.remove("quire-picked");
        picked = undefined;
        frame.classList.remove("shown");
        label.classList.remove("shown");
        setTimeout(() => !picked && frame.remove(), still() ? 0 : 220);
    }

    /** Takes the picked picture away, as one undo step. */
    function removePicked() {
        const path = picked;
        if (!path) return;
        unpick();
        surface.run((doc) => removeBlock(doc, path), "structure");
        surface.focus();
    }

    // ---- replacing it with another file ----
    const chooser = make("input", "quire-file");
    chooser.type = "file";
    chooser.accept = "image/*";
    chooser.tabIndex = -1;
    chooser.setAttribute("aria-hidden", "true");
    chooser.addEventListener("change", async () => {
        const file = chooser.files?.[0];
        chooser.value = "";
        const path = picked;
        if (!file || !path || !options.keep) return;
        // a store that cannot keep the picture says why, and the old one stays
        const src = await options.keep(file).catch(() => undefined);
        if (src) surface.run((doc) => setImage(doc, path, { src }));
    });

    // ---- the menu, at the pointer or under the strip's dots ----
    const menu = flowMenu("Picture", { className: "quire-picture-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    /** Where the panel grows from: the menu line pressed, or the picture. */
    let from: Box | undefined;
    menu.box.addEventListener("click", (event) => (from = (event.target as Element).closest(".quire-menu-line")?.getBoundingClientRect()), true);
    const lines = (): MenuItem[] => {
        const block = picked && pictureOf(picked);
        return [
            { label: "Caption", icon: "footnote", run: () => openPanel(caption) },
            { label: "Description", icon: "quote", run: () => openPanel(described) },
            { label: "Alignment", icon: "left", run: () => openPanel(sides.get(block?.align ?? "left")) },
            { label: "Size", icon: "image", run: () => openPanel([...sizes.values()][0]) },
            { label: "Wrap text", icon: "wrap", pressed: !!block?.wrap, run: () => change((path) => (doc) => setImage(doc, path, { wrap: !block?.wrap })) },
            { label: "Replace", icon: "redo", run: () => chooser.click() },
            { label: "Remove", icon: "trash", run: removePicked },
        ];
    };
    /** Opens the menu at a point in the window, or under a control. */
    function openMenu(at: HTMLElement | { x: number; y: number }, keyboard = false) {
        if (!picked) return;
        // focus is on the picture while its menu is open, so that closing it with Escape goes back there
        figureAt(picked)?.focus({ preventScroll: true });
        let trigger: HTMLElement;
        if (at instanceof HTMLElement) trigger = at;
        else {
            Object.assign(anchor.style, { left: `${at.x}px`, top: `${at.y}px`, height: "0px" });
            if (!anchor.isConnected) document.body.append(anchor);
            trigger = anchor;
        }
        menu.open(trigger, lines(), keyboard);
    }

    // ---- the panel at the right ----
    const panel = make("aside", "quire-picture-panel");
    panel.setAttribute("aria-label", "Picture");
    const skin = make("div", "quire-picture-skin");
    const inside = make("div", "quire-picture-in");
    panel.append(skin, inside);
    const head = make("div", "quire-picture-head");
    head.append(make("h2", "quire-picture-title", "Picture"), control("Close", icon("close"), () => closePanel(true)));
    const facts = make("dl", "quire-picture-facts");
    let fields = 0;
    /** A labelled line of the panel: its name, and what is in it. */
    const line = (term: string, ...held: HTMLElement[]) => {
        const name = make("dt", "", term);
        name.id = `quire-picture-${++fields}`;
        const value = make("dd");
        value.append(...held);
        value.setAttribute("role", "group");
        value.setAttribute("aria-labelledby", name.id);
        facts.append(name, value);
    };
    /** A field that keeps what was written when it is left, or Enter is pressed, as one undo step. */
    const field = (placeholder: string, keep: (value: string) => void) => {
        const input = make("input", "quire-picture-field");
        input.placeholder = placeholder;
        input.addEventListener("change", () => keep(input.value.trim()));
        input.addEventListener("keydown", (event) => event.key === "Enter" && input.blur());
        return input;
    };
    const caption = field("Words under the picture", (value) => change((path) => (doc) => setImage(doc, path, { caption: value || undefined })));
    const described = field("What the picture shows", (value) => change((path) => (doc) => setImage(doc, path, { alt: value })));
    const sides = new Map(SIDES.map(([align, words]) => [align, control(words, icon(align), () => sitAt(align))] as const));
    const sizes = new Map(SIZES.map(([name, width]) => [width, control(name === "Own size" ? "Its own size" : `${name} width`, name, () => change((path) => (doc) => setImage(doc, path, { width })), "quire-button quire-picture-size")] as const));
    const wrap = control("Text flows round the picture", "Off", () => change((path) => (doc) => setImage(doc, path, { wrap: !pictureOf(path)?.wrap })), "quire-button quire-picture-wrap");
    line("Caption", caption);
    line("Description", described);
    line("Alignment", ...sides.values());
    line("Size", ...sizes.values());
    line("Wrap text", wrap);
    const actions = make("div", "quire-picture-actions");
    actions.append(control("Replace the picture", "Replace", () => chooser.click(), "quire-button quire-picture-action"), control("Take the picture away", "Remove", removePicked, "quire-button quire-picture-action"));
    inside.append(head, facts, actions, chooser);

    const moving: Animation[] = [];
    const halt = () => {
        for (const each of moving.splice(0)) each.cancel();
    };
    const px = (inset: number[]) => inset.map((each) => `${each}px`).join(" ");
    let opened = false;
    /** Opens the panel, growing out of the line pressed (or the picture), with `focus` given the keyboard. */
    function openPanel(focus?: HTMLElement) {
        if (!picked) return;
        const start = from ?? boxOf(figureAt(picked) ?? root);
        from = undefined;
        place();
        if (!panel.isConnected) (options.margin ?? document.body).append(panel);
        options.margin?.classList.add("picturing");
        if (!opened && !still()) {
            halt();
            panel.classList.add("open");
            const here = boxOf(panel);
            const far = Math.hypot(start.left - here.left, start.top - here.top);
            const time = Math.round(DIALOG.open + Math.min(120, far / 8));
            moving.push(
                skin.animate([{ inset: px(insetOf(here, start)), borderRadius: "0.5rem" }, { inset: "0px" }], { duration: time, easing: springCurve(MOTION.bounce) }),
                inside.animate([{ opacity: 0, translate: "0 0.4rem" }, { opacity: 1, translate: "0 0" }], { duration: time * 0.6, delay: time * 0.35, easing: EASE, fill: "backwards" }),
            );
        }
        panel.classList.add("open");
        opened = true;
        focus?.focus({ preventScroll: true });
        // on a phone the panel stands at the window's foot, so the picture is brought up above it
        const figure = figureAt(picked);
        if (figure && matchMedia("(max-width: 40rem)").matches) scrollBy({ top: figure.getBoundingClientRect().top - 140, behavior: still() ? "auto" : "smooth" });
    }
    /** Closes the panel back into the picture; with `refocus`, the keyboard goes back to the picture too. */
    function closePanel(refocus: boolean) {
        if (!opened) return;
        opened = false;
        options.margin?.classList.remove("picturing");
        const figure = picked && figureAt(picked);
        const inPanel = panel.contains(document.activeElement);
        // what is being written is kept, as leaving the field would keep it
        if (inPanel) (document.activeElement as HTMLElement).blur();
        if (figure && (refocus || inPanel)) figure.focus({ preventScroll: true });
        halt();
        const done = () => !opened && panel.classList.remove("open");
        if (still() || !figure) return done();
        const here = boxOf(panel);
        moving.push(
            skin.animate([{ inset: "0px" }, { inset: px(insetOf(here, boxOf(figure))), borderRadius: "0.5rem" }], { duration: DIALOG.close, easing: EASE, fill: "forwards" }),
            inside.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DIALOG.close * 0.5, easing: "ease-in", fill: "forwards" }),
        );
        void Promise.all(moving.map((each) => each.finished)).then(() => {
            done();
            halt();
        }, () => {});
    }
    // Escape closes the panel wherever the keyboard is, as long as no menu took it first
    const onEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !opened || menu.isOpen()) return;
        event.preventDefault();
        event.stopPropagation();
        closePanel(true);
    };
    document.addEventListener("keydown", onEscape, true);

    // ---- resizing from a corner ----
    function resize(event: PointerEvent, corner: string) {
        const path = picked!;
        const figure = figureAt(path)!;
        const picture = figure.querySelector("img")!;
        const block = pictureOf(path)!;
        const start = event.clientX;
        const from = picture.getBoundingClientRect().width;
        // the width is a share of the text's, which a floated picture's own box is not
        const holder = getComputedStyle(figure.parentElement!);
        const room = figure.parentElement!.clientWidth - parseFloat(holder.paddingLeft) - parseFloat(holder.paddingRight) || 1;
        const sized = block.wrap ? figure : picture;
        // a centred picture grows on both sides at once, so a corner moves half as far as its width changes
        const both = block.align === "center" ? 2 : 1;
        const side = corner.endsWith("w") ? -1 : 1;
        let width = block.width;
        const handle = event.target as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        frame.classList.add("resizing");
        const move = (moved: PointerEvent) => {
            const snapped = snapWidth(((from + side * (moved.clientX - start) * both) / room) * 100);
            width = snapped.width;
            sized.style.width = `${width}%`;
            sized.style.maxWidth = "";
            label.textContent = snapped.snap ?? `${width}%`;
            label.classList.add("shown");
            label.classList.toggle("snapped", !!snapped.snap);
            place();
        };
        const done = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", done);
            handle.removeEventListener("pointercancel", done);
            frame.classList.remove("resizing");
            setTimeout(() => label.classList.remove("shown"), 500);
            if (width !== undefined && width !== block.width) surface.run((doc) => setImage(doc, path, { width }));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", done);
        handle.addEventListener("pointercancel", done);
    }

    // ---- dragging a picture to another place ----
    const dropLine = make("div", "quire-drop-line");
    /** How far the text opens where a dragged picture will land, in pixels. */
    const ROOM = 40;
    function drag(event: PointerEvent, figure: HTMLElement) {
        const path = pathOf(figure);
        const picture = figure.querySelector("img")!;
        const begin = { x: event.clientX, y: event.clientY };
        let lifted: HTMLElement | undefined;
        picture.setPointerCapture(event.pointerId);
        // every place it can land, measured once as the drag starts, in the page's own coordinates so that scrolling leaves them be:
        // the edge of the block it goes before or after, the space there now, and the block's left and width for the line
        const places = landings(surface.getDocument().blocks).flatMap((landing) => {
            const element = surface.elementAt(landing.path);
            if (!element) return [];
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const neighbour = landing.after ? element.nextElementSibling : element.previousElementSibling;
            const near = neighbour?.getBoundingClientRect();
            const space = near ? (landing.after ? near.top - box.bottom : box.top - near.bottom) : parseFloat(landing.after ? style.marginBottom : style.marginTop);
            return [{ landing, element, space: Math.max(0, space), y: (landing.after ? box.bottom : box.top) + scrollY, left: box.left, width: box.width }];
        });
        let open: (typeof places)[number] | undefined;
        /** The text opens at a place to show where the picture will land, and closes where it was open before. */
        const openAt = (place: typeof open) => {
            if (open === place) return;
            if (open) open.element.style[open.landing.after ? "marginBottom" : "marginTop"] = "";
            open = place;
            if (place) place.element.style[place.landing.after ? "marginBottom" : "marginTop"] = `${place.space + ROOM}px`;
        };
        const move = (moved: PointerEvent) => {
            if (!lifted) {
                if (Math.hypot(moved.clientX - begin.x, moved.clientY - begin.y) < 6) return;
                // the picture lifts off the page where it was pressed, smaller, and follows the pointer
                const box = picture.getBoundingClientRect();
                lifted = picture.cloneNode() as HTMLElement;
                lifted.className = "quire-lifted";
                Object.assign(lifted.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, transformOrigin: `${begin.x - box.left}px ${begin.y - box.top}px` });
                document.body.append(lifted, dropLine);
                figure.classList.add("quire-moving");
                root.classList.add("quire-making-room");
                requestAnimationFrame(() => lifted?.classList.add("up"));
            }
            lifted.style.translate = `${moved.clientX - begin.x}px ${moved.clientY - begin.y}px`;
            // the place whose gap is nearest as the text is drawn now (the open one wider by its room, those after it pushed
            // down by it); a place inside a list or quote is taken only with the pointer over its words, and then wins over
            // the one outside it at about the same height
            const y = moved.clientY + scrollY;
            const at = open ? places.indexOf(open) : places.length;
            const middle = (place: (typeof places)[number], index: number) => place.y + ((place.landing.after ? 1 : -1) * place.space) / 2 + (index > at ? ROOM : index === at ? ROOM / 2 : 0);
            let best = places[0];
            let score = Infinity;
            places.forEach((place, index) => {
                const far = Math.abs(middle(place, index) - y) + (moved.clientX < place.left ? 40 : -8 * place.landing.path.length);
                if (far <= score) [best, score] = [place, far];
            });
            const going = best && !staysPut(path, best.landing) ? best : undefined;
            openAt(going);
            if (going) Object.assign(dropLine.style, { left: `${going.left}px`, width: `${going.width}px`, top: `${going.y + ((going.landing.after ? 1 : -1) * going.space + ROOM) / 2 - scrollY}px` });
            dropLine.classList.toggle("shown", !!going);
            // near the window's top or bottom edge the page scrolls, so that a picture can go anywhere
            if (moved.clientY < 60) scrollBy(0, -12);
            else if (moved.clientY > innerHeight - 60) scrollBy(0, 12);
        };
        const done = () => {
            picture.removeEventListener("pointermove", move);
            picture.removeEventListener("pointerup", done);
            picture.removeEventListener("pointercancel", done);
            if (!lifted) return;
            const landing = open?.landing;
            openAt(undefined);
            setTimeout(() => root.classList.remove("quire-making-room"), 250);
            figure.classList.remove("quire-moving");
            dropLine.classList.remove("shown");
            const gone = lifted;
            gone.classList.remove("up");
            gone.classList.add("down");
            setTimeout(() => gone.remove(), still() ? 0 : 200);
            setTimeout(() => dropLine.remove(), 200);
            if (!landing) return;
            surface.run((doc) => moveBlockTo(doc, path, landing), "structure");
            requestAnimationFrame(() => pick(landedAt(path, landing)));
        };
        picture.addEventListener("pointermove", move);
        picture.addEventListener("pointerup", done);
        picture.addEventListener("pointercancel", done);
    }

    // ---- what the pointer and keys do ----
    function onPointerDown(event: PointerEvent) {
        const target = event.target as HTMLElement;
        const handle = target.closest<HTMLElement>(".quire-handle");
        if (handle && picked) {
            event.preventDefault();
            resize(event, handle.dataset.corner!);
            return;
        }
        if (target.closest(".quire-picture-strip")) return;
        const figure = target.closest<HTMLElement>("figure.quire-image");
        if (!figure || !root.contains(figure)) return;
        pick(pathOf(figure));
        if (target.tagName === "IMG" && event.button === 0) {
            event.preventDefault();
            drag(event, figure);
        }
    }
    function onOutside(event: PointerEvent) {
        if (!picked) return;
        const target = event.target as HTMLElement;
        if (target.closest?.("figure.quire-picked, .quire-frame, .quire-picture-panel, .quire-picture-menu, .quire-palette, .quire-palette-button")) return;
        unpick();
    }
    /** When the menu was last opened from the keyboard, whose own menu event may follow. */
    let keyedAt = 0;
    function onMenu(event: MouseEvent) {
        const figure = (event.target as HTMLElement).closest<HTMLElement>("figure.quire-image");
        if (!figure || !root.contains(figure)) return;
        event.preventDefault();
        event.stopPropagation();
        if (performance.now() - keyedAt < 500) return;
        pick(pathOf(figure));
        openMenu({ x: event.clientX, y: event.clientY });
    }
    function onKey(event: KeyboardEvent) {
        if (!picked) return;
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            // the menu key gives no pointer: the menu opens from the picture's corner
            event.preventDefault();
            keyedAt = performance.now();
            const box = figureAt(picked)?.querySelector("img")?.getBoundingClientRect();
            if (box) openMenu({ x: box.left + 16, y: box.top + 16 }, true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            unpick();
        } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            event.stopImmediatePropagation();
            removePicked();
        }
    }
    function onFocus(event: FocusEvent) {
        const figure = (event.target as HTMLElement).closest?.<HTMLElement>("figure.quire-image");
        if (figure && root.contains(figure)) pick(pathOf(figure));
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("contextmenu", onMenu);
    root.addEventListener("keydown", onKey, true);
    root.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onOutside, true);
    const stop = surface.on("change", () => {
        if (!picked) return;
        if (!pictureOf(picked)) return unpick();
        // the picture was drawn again: the frame goes back onto it
        figureAt(picked)?.classList.add("quire-picked");
        place();
    });
    addEventListener("resize", place);

    return {
        /** The path of the picked picture, if one is. */
        picked: () => picked,
        /** The lines of the picked picture's menu, for the command palette; none when no picture is picked. */
        lines: () => (picked ? lines() : []),
        pick,
        unpick,
        destroy() {
            stop();
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("contextmenu", onMenu);
            root.removeEventListener("keydown", onKey, true);
            root.removeEventListener("focusin", onFocus);
            document.removeEventListener("pointerdown", onOutside, true);
            document.removeEventListener("keydown", onEscape, true);
            removeEventListener("resize", place);
            for (const each of [frame, dropLine, anchor, panel, menu.box]) each.remove();
        },
    };
}
