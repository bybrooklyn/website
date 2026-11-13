// What a person does to a picture in the text. Pressed, a picture is picked: a frame with a handle
// at each corner grows round it, and a small strip above it sets its alignment, puts it back to its
// own size or takes it away. Dragging a corner resizes it, keeping its shape, drawn gently to the
// text's full width, half and a third (pictures.ts counts that); the frame says which. Dragging
// the picture itself lifts it, a line shows where it will land between the blocks, and letting go
// puts it there. The caption and the alt text are written in place under it. Each change is one
// undo step. Pasting or dropping picture files is the surface's (surface.ts).
//
// Only a picture standing as a block of its own is picked; one inside a line of text is not. One
// inside a list or quote can be resized but not dragged elsewhere.
//
//   const pictures = createPictureTools(surface);   // pictures.destroy()

import { blockAt, removeBlock, setAlign, setImage, type Align, type Image } from "./document";
import { moveTo, snapWidth } from "./pictures";
import type { Surface } from "./surface";
import { control, icon, make, still } from "./ui";

/** Draws a picture block for the surface: the picture at its width, its caption and its alt text, each written in place. */
export function drawPicture(block: Image, inner: number[]): HTMLElement {
    const figure = make("figure", "quire-image");
    figure.contentEditable = "false";
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
    const caption = make("input", "quire-caption");
    caption.value = block.caption ?? "";
    caption.placeholder = "Add a caption";
    caption.setAttribute("aria-label", "Caption");
    caption.dataset.caption = inner.join(",");
    // the alt text sits under the picture, written in place; it is kept when the field is left
    const alt = make("input", "quire-alt");
    alt.value = block.alt;
    alt.placeholder = "Describe the picture";
    alt.setAttribute("aria-label", "What the picture shows");
    alt.dataset.alt = inner.join(",");
    figure.append(picture, caption, alt);
    return figure;
}

/** The handles, by the corner each is at. */
const CORNERS = ["nw", "ne", "sw", "se"] as const;

/** Builds the picture tools for a surface. */
export function createPictureTools(surface: Surface) {
    const root = surface.element;
    // a press on a picture picks it here; the site's picture viewer (src/scripts/viewer.ts), which opens on any picture in prose, is told to leave these alone
    root.dataset.noView = "";
    let picked: number[] | undefined;

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
    const doing = (change: (path: number[]) => void) => () => picked && change(picked);
    for (const [align, words] of [
        ["left", "Picture to the left"],
        ["center", "Picture in the centre"],
        ["right", "Picture to the right"],
    ] as [Align, string][]) {
        const button = control(words, icon(align), doing((path) => surface.run((doc) => setAlign(doc, path, align === "left" ? null : align))));
        aligns.set(align, button);
        strip.append(button);
    }
    const own = control("Its own size", "Own size", doing((path) => surface.run((doc) => setImage(doc, path, { width: undefined }))), "quire-button quire-own-size");
    const remove = control(
        "Take the picture away",
        icon("trash"),
        doing((path) => {
            unpick();
            surface.run((doc) => removeBlock(doc, path), "structure");
            surface.focus();
        }),
    );
    strip.append(make("span", "quire-select-rule"), own, remove);
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

    /** Puts the frame over the picture as it is drawn now, and the strip's buttons as the picture stands. */
    function place() {
        const figure = picked && figureAt(picked);
        const picture = figure?.querySelector("img");
        const block = picked && pictureOf(picked);
        if (!figure || !picture || !block) return;
        // a picture still loading has no size yet: the frame is put on it once it has
        if (!picture.complete) picture.addEventListener("load", place, { once: true });
        if (frame.parentElement !== figure) figure.append(frame);
        Object.assign(frame.style, { left: `${picture.offsetLeft}px`, top: `${picture.offsetTop}px`, width: `${picture.offsetWidth}px`, height: `${picture.offsetHeight}px` });
        for (const [align, button] of aligns) {
            const on = (block.align ?? "left") === align;
            button.classList.toggle("pressed", on);
            button.setAttribute("aria-pressed", String(on));
        }
        own.classList.toggle("absent", block.width === undefined);
        own.tabIndex = block.width === undefined ? -1 : 0;
        // the strip goes under the picture when there is no room above it in the window
        frame.classList.toggle("low", picture.getBoundingClientRect().top < 120);
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

    /** Lets the picked picture go: the frame shrinks away into it. */
    function unpick() {
        if (!picked) return;
        figureAt(picked)?.classList.remove("quire-picked");
        picked = undefined;
        frame.classList.remove("shown");
        label.classList.remove("shown");
        setTimeout(() => !picked && frame.remove(), still() ? 0 : 220);
    }

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
    const line = make("div", "quire-drop-line");
    function drag(event: PointerEvent, figure: HTMLElement) {
        const path = pathOf(figure);
        const picture = figure.querySelector("img")!;
        const begin = { x: event.clientX, y: event.clientY };
        let lifted: HTMLElement | undefined;
        let to: number | undefined;
        picture.setPointerCapture(event.pointerId);
        const gaps = () => {
            const blocks = [...root.children] as HTMLElement[];
            return blocks.map((block, index) => {
                const box = block.getBoundingClientRect();
                const before = blocks[index - 1]?.getBoundingClientRect();
                return { index, y: before ? (before.bottom + box.top) / 2 : box.top - 4 };
            }).concat(blocks.length ? [{ index: blocks.length, y: blocks[blocks.length - 1]!.getBoundingClientRect().bottom + 4 }] : []);
        };
        const move = (moved: PointerEvent) => {
            if (!lifted) {
                if (Math.hypot(moved.clientX - begin.x, moved.clientY - begin.y) < 6 || path.length !== 1) return;
                // the picture lifts off the page where it was pressed, smaller, and follows the pointer
                const box = picture.getBoundingClientRect();
                lifted = picture.cloneNode() as HTMLElement;
                lifted.className = "quire-lifted";
                Object.assign(lifted.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, transformOrigin: `${begin.x - box.left}px ${begin.y - box.top}px` });
                document.body.append(lifted, line);
                figure.classList.add("quire-moving");
                requestAnimationFrame(() => lifted?.classList.add("up"));
            }
            lifted.style.translate = `${moved.clientX - begin.x}px ${moved.clientY - begin.y}px`;
            const all = gaps();
            const near = all.reduce((best, gap) => (Math.abs(gap.y - moved.clientY) < Math.abs(best.y - moved.clientY) ? gap : best), all[0]!);
            to = near.index;
            const still = to === path[0] || to === path[0]! + 1;
            const box = root.getBoundingClientRect();
            Object.assign(line.style, { left: `${box.left}px`, width: `${box.width}px`, top: `${near.y}px` });
            line.classList.toggle("shown", !still);
            // near the window's top or bottom edge the page scrolls, so that a picture can go anywhere
            if (moved.clientY < 60) scrollBy(0, -12);
            else if (moved.clientY > innerHeight - 60) scrollBy(0, 12);
        };
        const done = () => {
            picture.removeEventListener("pointermove", move);
            picture.removeEventListener("pointerup", done);
            picture.removeEventListener("pointercancel", done);
            if (!lifted) return;
            figure.classList.remove("quire-moving");
            line.classList.remove("shown");
            const gone = lifted;
            gone.classList.remove("up");
            gone.classList.add("down");
            setTimeout(() => gone.remove(), still() ? 0 : 200);
            setTimeout(() => line.remove(), 200);
            if (to === undefined || to === path[0] || to === path[0]! + 1) return;
            const target = to > path[0]! ? to - 1 : to;
            const from = path[0]!;
            const landing = to;
            surface.run((doc) => moveTo(doc, from, landing), "structure");
            requestAnimationFrame(() => pick([target]));
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
        if (target.closest?.("figure.quire-picked, .quire-frame")) return;
        unpick();
    }
    function onKey(event: KeyboardEvent) {
        const field = event.target instanceof HTMLInputElement && event.target.closest("figure.quire-image");
        // Enter keeps what was written in a caption or alt text, as leaving the field does
        if (field && event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
            return;
        }
        if (!picked || field) return;
        if (event.key === "Escape") {
            event.preventDefault();
            unpick();
        } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            event.stopImmediatePropagation();
            const path = picked;
            unpick();
            surface.run((doc) => removeBlock(doc, path), "structure");
        }
    }
    function onFocus(event: FocusEvent) {
        const figure = (event.target as HTMLElement).closest?.<HTMLElement>("figure.quire-image");
        if (figure && root.contains(figure)) pick(pathOf(figure));
    }
    function onChange(event: Event) {
        const field = event.target as HTMLInputElement;
        if (!field.matches?.("[data-caption]")) return;
        const figure = field.closest<HTMLElement>("figure.quire-image");
        if (!figure) return;
        const path = pathOf(figure);
        surface.run((doc) => setImage(doc, path, { caption: field.value.trim() || undefined }));
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("keydown", onKey, true);
    root.addEventListener("focusin", onFocus);
    root.addEventListener("change", onChange);
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
        pick,
        unpick,
        destroy() {
            stop();
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("keydown", onKey, true);
            root.removeEventListener("focusin", onFocus);
            root.removeEventListener("change", onChange);
            document.removeEventListener("pointerdown", onOutside, true);
            removeEventListener("resize", place);
            frame.remove();
            line.remove();
        },
    };
}
