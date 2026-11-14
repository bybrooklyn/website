// The stage: the picture on the screen and the tools that work on it. The picture is drawn on the
// card (draw.ts) with the marks over it on a 2D canvas, fitted to the room under the bar, zoomed by
// the wheel, two fingers or the keys and moved by dragging with Space held (or the middle button).
// The crop's frame is on it from the first second; its handles, dragged, nudged by the arrow keys and
// held to a shape, set the crop when Enter is pressed. Hiding is a drag: what is under it is covered
// at once, in the color round it. An arrow and a box are dragged out, a line of text is typed where
// the picture is pressed, and each mark can be picked and moved afterwards, since every one is a step.
// While a drag goes on the steps it would make are drawn as they are; only letting go makes the change,
// so that one drag is one undo.
//
// Once the text reader has read the picture, its words are known here (`setWords`). With the tool for
// reading on, every word is tinted lightly and the one under the pointer more, what looks private is
// outlined, and pressing a word hides it: a cover over exactly its box and a stated margin, the same
// cover Hide makes; a drag across words hides the run, one cover a line. With no tool, a drag across
// words selects them, to be copied as text.

import { backendFor, loadPicture, type Loaded, type Scene, type View } from "./draw";
import { coverColor, ringArea } from "./cover";
import { dragFrame, fit, HANDLES, oneToOne, shapeFrame, spanned, zoomAt, type Handle } from "./geometry";
import { allAt, drawMarks, markBox, moved, type Place } from "./marks";
import { add, change, look, within, type Kept, type Look, type Mark, type Picture, type Point, type Rect } from "./steps";
import { corners } from "./read/pixels";
import { coverFor, type Line } from "./read/words";
import type { Finding } from "./read/private";
import { make } from "../core/ui";

/** The tools: the crop's frame, hiding, the three marks, reading text, or none (dragging then picks and moves, or selects words). */
export type Tool = "crop" | "hide" | "arrow" | "box" | "text" | "read" | "none";

/** A word on the stage: its text and box, its line, and the cover pressing it makes. */
export interface PlacedWord {
    text: string;
    box: Line["box"];
    line: number;
    cover: Rect;
}

/** The words of lines, in reading order, each with its cover: its box grown by a tenth of its line's height. */
export function placeWords(lines: Line[]): PlacedWord[] {
    return lines.flatMap((line, index) => line.words.map((word) => ({ text: word.text, box: word.box, line: index, cover: coverFor(word, line.box.height) })));
}

/** The covers for a run of words (indices into `words`): one over each stretch of the run on one line, round the covers of its words. */
export function runCovers(words: PlacedWord[], indices: number[]): Rect[] {
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    const covers: Rect[] = [];
    let stretch: number[] = [];
    const close = () => {
        if (!stretch.length) return;
        const rects = stretch.map((at) => words[at]!.cover);
        const left = Math.min(...rects.map((rect) => rect.x));
        const top = Math.min(...rects.map((rect) => rect.y));
        covers.push({ x: left, y: top, width: Math.max(...rects.map((rect) => rect.x + rect.width)) - left, height: Math.max(...rects.map((rect) => rect.y + rect.height)) - top });
        stretch = [];
    };
    for (const at of sorted) {
        const last = stretch.at(-1);
        if (last !== undefined && (at !== last + 1 || words[at]!.line !== words[last]!.line)) close();
        stretch.push(at);
    }
    close();
    return covers;
}

/** The covers for something that looks private (indices into `words`): one a line, edge to edge from its first word on that line to its last, so that nothing between its parts shows how it is grouped. */
export function findingCovers(words: PlacedWord[], finding: number[]): Rect[] {
    const lines = new Map<number, number[]>();
    for (const at of finding) lines.set(words[at]!.line, [...(lines.get(words[at]!.line) ?? []), at]);
    return [...lines.values()].flatMap((indices) => {
        const all: number[] = [];
        for (let at = Math.min(...indices); at <= Math.max(...indices); at++) all.push(at);
        return runCovers(words, all);
    });
}

/** Whether a rectangle lies wholly inside one of the covers. */
export const coveredBy = (covers: Rect[], rect: Rect): boolean => covers.some((cover) => cover.x <= rect.x && cover.y <= rect.y && cover.x + cover.width >= rect.x + rect.width && cover.y + cover.height >= rect.y + rect.height);

/** The text of a run of words: words of a line joined by spaces, lines by line breaks. */
export function runText(words: PlacedWord[], from: number, to: number): string {
    let text = "";
    for (let at = Math.min(from, to); at <= Math.max(from, to); at++) {
        const word = words[at];
        if (!word) continue;
        if (text) text += words[at - 1]?.line === word.line ? " " : "\n";
        text += word.text;
    }
    return text;
}

/** How new marks are drawn: their color, and their thickness as a share of the picture's longer side. */
export interface Pen {
    color: string;
    weight: number;
}

/** What the stage is given by the editor: the document, and where its changes go. */
export interface StageHooks {
    picture(): Picture | undefined;
    /** A change to the steps, as one undo. */
    change(steps: Kept[]): void;
    pen(): Pen;
    /** The tool changed, or the frame, or what is picked: the bar and the strip follow. */
    moved(): void;
    say(short: string, full: string): void;
}

/** The thickness of a mark from a pen, in the original's pixels: at least two. */
export const thickness = (pen: Pen, size: { width: number; height: number }) => Math.max(2, Math.round(Math.max(size.width, size.height) * pen.weight));

/** Builds the stage on an element. */
export function createStage(hooks: StageHooks) {
    const element = make("div", "quire-img-stage");
    element.tabIndex = 0;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", "Picture");
    let canvas = make("canvas", "quire-img-canvas");
    const over = make("canvas", "quire-img-over");
    const frame = make("div", "quire-img-frame");
    for (const [handle] of HANDLES) {
        const grip = make("span", `quire-img-grip quire-img-grip-${handle}`);
        grip.dataset.handle = handle;
        frame.append(grip);
    }
    const writing = make("input", "quire-img-writing");
    writing.type = "text";
    writing.setAttribute("aria-label", "Text");
    element.append(canvas, over, frame, writing);

    let loaded: Loaded | undefined;
    let blob: Blob | undefined;
    let tool: Tool = "crop";
    let view: View = { scale: 1, x: 0, y: 0 };
    // the crop's frame while it is being set, in the original's pixels; it becomes the crop on Enter
    let cropFrame: Rect | undefined;
    let aspect: number | undefined;
    // the steps drawn while a drag goes on, before letting go makes them a change
    let live: Kept[] | undefined;
    let picked: string | undefined;
    let drawn = 0;
    let sizeOf = { width: 0, height: 0 };
    // the words the reader found, what of them looks private, the word under the pointer, and a run being dragged or selected
    let words: PlacedWord[] = [];
    let findings: number[][] = [];
    let hover: number | undefined;
    let run: [number, number] | undefined;
    let selection: [number, number] | undefined;

    const picture = () => {
        const found = hooks.picture();
        return found && live ? { ...found, steps: live } : found;
    };
    const shown = (): Look | undefined => {
        const found = picture();
        return found && look(found);
    };
    const cropping = () => tool === "crop";
    /** Where the original's pixels fall on the stage, in its own CSS pixels. */
    const place = (): Place => {
        const now = shown();
        if (!now || cropping()) return { across: view.scale, down: view.scale, x: view.x, y: view.y };
        const across = (view.scale * now.width) / now.crop.width;
        const down = (view.scale * now.height) / now.crop.height;
        return { across, down, x: view.x - now.crop.x * across, y: view.y - now.crop.y * down };
    };
    const toOriginal = (at: Point): Point => {
        const where = place();
        return { x: (at.x - where.x) / where.across, y: (at.y - where.y) / where.down };
    };
    const toStage = (rect: Rect): Rect => {
        const where = place();
        return { x: where.x + rect.x * where.across, y: where.y + rect.y * where.down, width: rect.width * where.across, height: rect.height * where.down };
    };
    const pointer = (event: { clientX: number; clientY: number }): Point => {
        const box = element.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    // ---- drawing, once a frame at most ----
    let asked = false;
    const paint = () => {
        if (asked) return;
        asked = true;
        requestAnimationFrame(() => {
            asked = false;
            draw();
        });
    };
    function draw() {
        const now = shown();
        const ratio = devicePixelRatio || 1;
        const width = Math.max(1, Math.round(element.clientWidth * ratio));
        const height = Math.max(1, Math.round(element.clientHeight * ratio));
        for (const each of [canvas, over]) if (each.width !== width || each.height !== height) [each.width, each.height] = [width, height];
        const context = over.getContext("2d")!;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        frame.classList.toggle("shown", !!now && !!loaded && cropping() && !!cropFrame);
        if (!now || !loaded) return;
        const scene: Scene = { look: cropping() && cropFrame ? { ...now, crop: cropFrame } : now, view: { scale: view.scale * ratio, x: view.x * ratio, y: view.y * ratio }, canvas: { width, height }, ...(cropping() ? { cropping: { x: 0, y: 0, ...loaded.size } } : {}) };
        loaded.draw(scene, paint);
        drawn++;
        const where = place();
        const scaled = { across: where.across * ratio, down: where.down * ratio, x: where.x * ratio, y: where.y * ratio };
        // marks are seen in crop mode too, but cut to the frame as they will be
        context.save();
        const kept = toStage(cropping() && cropFrame ? cropFrame : now.crop);
        context.beginPath();
        context.rect(kept.x * ratio, kept.y * ratio, kept.width * ratio, kept.height * ratio);
        context.clip();
        drawMarks(context, now.marks, scaled);
        if (words.length && (tool === "read" || selection)) drawWords(context, scaled, ratio);
        context.restore();
        // what is picked: a fine ring round it in the page's accent
        const chosen = picture()?.steps.find((step) => step.id === picked);
        if (chosen && (chosen.type === "cover" || chosen.type === "arrow" || chosen.type === "box" || chosen.type === "text")) {
            const box = toStage(chosen.type === "cover" ? chosen.rect : markBox(chosen));
            context.strokeStyle = getComputedStyle(element).getPropertyValue("--accent") || "#b48cff";
            context.lineWidth = 1.5 * ratio;
            context.setLineDash([5 * ratio, 4 * ratio]);
            context.strokeRect((box.x - 4) * ratio, (box.y - 4) * ratio, (box.width + 8) * ratio, (box.height + 8) * ratio);
        }
        if (cropping() && cropFrame) {
            const box = toStage(cropFrame);
            Object.assign(frame.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
        }
    }

    /** The words lightly tinted while reading, the one under the pointer more, a run or a selection fully, and what looks private outlined. */
    function drawWords(context: CanvasRenderingContext2D, where: Place, ratio: number) {
        const accent = getComputedStyle(element).getPropertyValue("--accent").trim() || "#b48cff";
        const quad = (index: number) => {
            const points = corners(words[index]!.box).map((point) => ({ x: where.x + point.x * where.across, y: where.y + point.y * where.down }));
            context.beginPath();
            context.moveTo(points[0]!.x, points[0]!.y);
            for (const point of points.slice(1)) context.lineTo(point.x, point.y);
            context.closePath();
        };
        const chosen = run ?? selection;
        const low = chosen ? Math.min(...chosen) : -1;
        const high = chosen ? Math.max(...chosen) : -1;
        const rect = (cover: Rect) => [where.x + cover.x * where.across, where.y + cover.y * where.down, cover.width * where.across, cover.height * where.down] as const;
        context.fillStyle = accent;
        if (tool === "read") {
            words.forEach((_, index) => {
                if ((index >= low && index <= high) ) return;
                context.globalAlpha = index === hover ? 0.35 : 0.2;
                quad(index);
                context.fill();
            });
        }
        // a run or a selection is filled as one stretch a line, the gaps between its words too, as selected text is
        if (chosen) {
            context.globalAlpha = 0.38;
            const indices: number[] = [];
            for (let index = low; index <= high; index++) indices.push(index);
            for (const cover of runCovers(words, indices)) context.fillRect(...rect(cover));
        }
        context.globalAlpha = 1;
        if (tool !== "read") return;
        // what looks private: a warm line round each stretch of it, dashed where it is large enough to show the dashes
        context.strokeStyle = "#ff9f0a";
        context.lineWidth = 1.5 * ratio;
        for (const finding of uncovered())
            for (const cover of findingCovers(words, finding)) {
                const [x, y, width, height] = rect(cover);
                context.setLineDash(height >= 12 * ratio ? [4 * ratio, 3 * ratio] : []);
                context.strokeRect(x, y, width, height);
            }
        context.setLineDash([]);
    }

    /** What looks private and is not yet under a cover: each thing whose words are not all inside covers already made. */
    function uncovered(): number[][] {
        const found = picture();
        if (!found) return findings;
        const covers = look(found).covers.map((cover) => cover.rect);
        return findings.filter((finding) => findingCovers(words, finding).some((rect) => !coveredBy(covers, within(rect, found.original))));
    }
    /** The word whose cover a place in the original's pixels is in, the smallest where covers overlap. */
    function wordAt(at: Point): number | undefined {
        let best: number | undefined;
        words.forEach((word, index) => {
            const { cover } = word;
            if (at.x < cover.x || at.y < cover.y || at.x > cover.x + cover.width || at.y > cover.y + cover.height) return;
            if (best === undefined || cover.width * cover.height < words[best]!.cover.width * words[best]!.cover.height) best = index;
        });
        return best;
    }
    /** The word nearest a place, for a drag that has left the words. */
    function nearestWord(at: Point): number | undefined {
        let best: number | undefined;
        let far = Infinity;
        words.forEach(({ cover }, index) => {
            const dx = Math.max(cover.x - at.x, 0, at.x - cover.x - cover.width);
            const dy = Math.max(cover.y - at.y, 0, at.y - cover.y - cover.height);
            // a line above or below counts for more than a word along the same line
            const distance = dx + dy * 4;
            if (distance < far) [far, best] = [distance, index];
        });
        return best;
    }

    /** Hides words: one cover over each stretch of them on a line, each in the color round it, all as one change. */
    async function hideWords(indices: number[]) {
        return hideRects(runCovers(words, indices));
    }
    /** Hides everything that looks private and is not yet covered: one cover a line of each thing, all as one change. */
    async function hideFindings(only?: number[][]) {
        return hideRects((only ?? uncovered()).flatMap((finding) => findingCovers(words, finding)));
    }
    /** Covers rectangles, each in the color round it, as one change. */
    async function hideRects(rects: Rect[]) {
        const found = hooks.picture();
        if (!found || !loaded || !rects.length) return;
        let steps = found.steps;
        for (const cover of rects) {
            const rect = within(cover, found.original);
            const area = ringArea(rect, loaded.size);
            steps = add(steps, { type: "cover", rect, color: coverColor(await loaded.pixels(area), area, rect) });
        }
        hooks.change(steps);
    }

    // ---- the view ----
    /** Fits what is shown (the whole original while cropping, the picture as it looks otherwise) to the room. */
    function fitView() {
        const now = shown();
        if (!now || !loaded) return;
        // the room under the tool's strip, so that the strip never lies over the picture when it is fitted
        const below = 52;
        view = fit(cropping() ? loaded.size : now, { width: element.clientWidth, height: element.clientHeight - below });
        view = { ...view, y: view.y + below };
        paint();
    }
    const zoom = (by: number, at: Point = { x: element.clientWidth / 2, y: element.clientHeight / 2 }) => ((view = zoomAt(view, by, at)), paint());

    // ---- tools ----
    function setTool(next: Tool) {
        if (next === tool) return;
        if (tool === "crop") cropFrame = undefined;
        if (tool === "text") keepWriting();
        const was = cropping();
        tool = next;
        picked = undefined;
        hover = undefined;
        run = undefined;
        selection = undefined;
        element.dataset.over = "";
        if (next === "crop") cropFrame = shown()?.crop;
        element.dataset.tool = next;
        if (was !== cropping()) fitView();
        paint();
        hooks.moved();
    }

    /** Makes the crop's frame the picture's crop. True when it changed anything. */
    function applyCrop(): boolean {
        const found = hooks.picture();
        if (!found || !cropFrame) return false;
        const rect = within(cropFrame, found.original);
        const now = look(found).crop;
        const whole = rect.x === 0 && rect.y === 0 && rect.width === found.original.width && rect.height === found.original.height;
        const there = found.steps.find((step) => step.type === "crop");
        if (rect.x === now.x && rect.y === now.y && rect.width === now.width && rect.height === now.height) return false;
        // a frame back on the whole picture takes the crop away rather than keeping one that does nothing
        hooks.change(there ? (whole ? found.steps.filter((step) => step !== there) : change(found.steps, there.id, { rect })) : add(found.steps, { type: "crop", rect }));
        return true;
    }

    /** Holds the frame to a shape, or lets it go free. */
    function setAspect(next: number | undefined) {
        aspect = next;
        if (next && cropFrame && loaded) cropFrame = shapeFrame(cropFrame, next, loaded.size);
        paint();
        hooks.moved();
    }

    // ---- dragging ----
    type Drag = { kind: "pan"; from: Point; view: View } | { kind: "frame"; handle: Handle; from: Point; start: Rect } | { kind: "draw"; from: Point } | { kind: "move"; id: string; from: Point; steps: Kept[]; beneath?: string } | { kind: "words"; from: number } | { kind: "select"; from: number };
    let drag: Drag | undefined;
    let spaceHeld = false;
    const fingers = new Map<number, Point>();
    let pinch: { distance: number; middle: Point; view: View } | undefined;

    /** The steps a drawing drag makes so far: a cover or a mark from where it started to here, or nothing yet. */
    function drawing(from: Point, to: Point): Kept[] | undefined {
        const found = hooks.picture();
        if (!found) return undefined;
        const pen = hooks.pen();
        const line = thickness(pen, found.original);
        if (tool === "hide") return add(found.steps, { type: "cover", rect: spanned(from, to), color: "#000000" });
        if (tool === "box") return add(found.steps, { type: "box", rect: spanned(from, to), color: pen.color, thickness: line });
        if (tool === "arrow") return add(found.steps, { type: "arrow", from, to, color: pen.color, thickness: line });
        return undefined;
    }

    element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        element.focus({ preventScroll: true });
        // no selection and no dragging of what is under the pointer by the browser, which would cancel the drag part way
        if (event.pointerType === "mouse") event.preventDefault();
        if (event.pointerType === "touch") {
            fingers.set(event.pointerId, pointer(event));
            if (fingers.size === 2) {
                const [a, b] = [...fingers.values()] as [Point, Point];
                pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
                drag = undefined;
                live = undefined;
                return;
            }
        }
        const at = pointer(event);
        const found = hooks.picture();
        if (!found || !loaded) return;
        element.setPointerCapture(event.pointerId);
        if (event.button === 1 || spaceHeld) return void (drag = { kind: "pan", from: at, view });
        const there = toOriginal(at);
        if (tool === "crop") {
            const handle = (event.target as HTMLElement).dataset?.handle as Handle | undefined;
            const inside = cropFrame && there.x >= cropFrame.x && there.x <= cropFrame.x + cropFrame.width && there.y >= cropFrame.y && there.y <= cropFrame.y + cropFrame.height;
            // pressed outside the frame, a new one is dragged out from there
            if (!handle && !inside) cropFrame = { x: Math.round(there.x), y: Math.round(there.y), width: 1, height: 1 };
            drag = { kind: "frame", handle: handle ?? (inside ? "move" : "se"), from: there, start: cropFrame! };
            return;
        }
        if (tool === "text") {
            event.preventDefault();
            startWriting(there);
            return;
        }
        // a mark or a cover under the pointer is picked and can be moved, whatever the tool
        // (covers only with Hide or no tool, so that an arrow can start inside one); pressed again where one
        // is picked and let go without moving, the one beneath it is picked, round to the top again
        const steps = found.steps;
        const pickable = steps.filter((step) => !step.off && (step.type === "arrow" || step.type === "box" || step.type === "text" || (step.type === "cover" && (tool === "hide" || tool === "none" || tool === "read")))) as (Kept & (Mark | { type: "cover"; rect: Rect }))[];
        const under = allAt(pickable, there, 6 / place().across).map((at) => pickable[at]!);
        const now = under.findIndex((step) => step.id === picked);
        const target = under[Math.max(0, now)];
        if (target) {
            picked = target.id;
            drag = { kind: "move", id: target.id, from: there, steps, beneath: now >= 0 && under.length > 1 ? under[(now + 1) % under.length]!.id : undefined };
            hooks.moved();
            paint();
            return;
        }
        picked = undefined;
        // a word pressed: hidden when reading, selected with no tool
        const word = words.length && (tool === "read" || tool === "none") ? wordAt(there) : undefined;
        if (word !== undefined) {
            if (tool === "read") {
                drag = { kind: "words", from: word };
                run = [word, word];
            } else {
                drag = { kind: "select", from: word };
                selection = [word, word];
            }
        } else if (tool === "none" || tool === "read") {
            selection = undefined;
            drag = { kind: "pan", from: at, view };
        } else drag = { kind: "draw", from: there };
        hooks.moved();
        paint();
    });

    /** Follows the pointer: a pinch, a pan, the frame, a mark being drawn or one being moved. */
    function follow(event: PointerEvent) {
        const at = pointer(event);
        if (event.pointerType === "touch" && fingers.has(event.pointerId)) {
            fingers.set(event.pointerId, at);
            if (pinch && fingers.size === 2) {
                const [a, b] = [...fingers.values()] as [Point, Point];
                const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const zoomed = zoomAt(pinch.view, Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, pinch.middle);
                view = { ...zoomed, x: zoomed.x + middle.x - pinch.middle.x, y: zoomed.y + middle.y - pinch.middle.y };
                return paint();
            }
        }
        if (!drag && loaded && words.length && event.pointerType !== "touch" && (tool === "read" || tool === "none")) {
            // the word under the pointer, lit while reading, and the pointer saying text can be pressed
            const over = wordAt(toOriginal(at));
            element.dataset.over = over === undefined ? "" : "word";
            if (tool === "read" && over !== hover) {
                hover = over;
                paint();
            }
        }
        if (!drag || !loaded) return;
        const there = toOriginal(at);
        if (drag.kind === "words" || drag.kind === "select") {
            const to = wordAt(there) ?? nearestWord(there) ?? drag.from;
            if (drag.kind === "words") run = [drag.from, to];
            else selection = [drag.from, to];
            return paint();
        }
        if (drag.kind === "pan") view = { ...drag.view, x: drag.view.x + at.x - drag.from.x, y: drag.view.y + at.y - drag.from.y };
        else if (drag.kind === "frame") cropFrame = dragFrame(drag.start, drag.handle, { x: there.x - drag.from.x, y: there.y - drag.from.y }, loaded.size, aspect ?? (event.shiftKey && drag.handle.length === 2 ? drag.start.width / drag.start.height : undefined));
        else if (drag.kind === "draw") live = drawing(drag.from, there);
        else {
            const by = { x: there.x - drag.from.x, y: there.y - drag.from.y };
            const id = drag.id;
            live = drag.steps.map((step) => (step.id !== id ? step : step.type === "cover" ? { ...step, rect: { ...step.rect, x: step.rect.x + by.x, y: step.rect.y + by.y } } : step.type === "arrow" || step.type === "box" || step.type === "text" ? ({ ...moved(step, by), id: step.id } as Kept) : step));
        }
        paint();
    }
    element.addEventListener("pointermove", follow);
    element.addEventListener("pointerleave", () => {
        if (hover === undefined) return;
        hover = undefined;
        paint();
    });

    const letGo = async (event: PointerEvent) => {
        // the browser may hand over the last move only after letting go, so where it was let go counts
        if (drag && event.type === "pointerup" && event.pointerType !== "touch") follow(event);
        fingers.delete(event.pointerId);
        if (fingers.size < 2) pinch = undefined;
        const was = drag;
        drag = undefined;
        if (!was) return;
        const made = live;
        live = undefined;
        if (was.kind === "frame") return hooks.moved();
        if (was.kind === "select") return hooks.moved();
        if (was.kind === "words") {
            const chosen = run;
            run = undefined;
            if (chosen) {
                // one word pressed that is part of something that looks private hides the whole of it
                const whole = chosen[0] === chosen[1] ? findings.find((finding) => finding.includes(chosen[0])) : undefined;
                if (whole) await hideFindings([whole]);
                else {
                    const indices: number[] = [];
                    for (let index = Math.min(...chosen); index <= Math.max(...chosen); index++) indices.push(index);
                    await hideWords(indices);
                }
            }
            hooks.moved();
            return paint();
        }
        if (was.kind === "move") {
            const still = !made || made.every((step, at) => step === was.steps[at] || JSON.stringify(step) === JSON.stringify(was.steps[at]));
            if (!still) hooks.change(made!.map((step) => (step.type === "cover" && step.id === was.id ? { ...step, rect: within(step.rect, hooks.picture()!.original) } : step)));
            else if (was.beneath) {
                picked = was.beneath;
                hooks.moved();
            }
            return paint();
        }
        if (was.kind !== "draw" || !made) return paint();
        const step = made.at(-1)!;
        const where = place();
        // a press with hardly any drag makes nothing
        const size = step.type === "arrow" ? Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) * where.across : step.type === "cover" || step.type === "box" ? Math.min(step.rect.width, step.rect.height) * where.across : 0;
        if (size < 4) return paint();
        if (step.type === "cover") {
            // the cover takes the color round where it was put, from the original's own pixels
            const rect = within(step.rect, hooks.picture()!.original);
            const area = ringArea(rect, loaded!.size);
            const color = coverColor(await loaded!.pixels(area), area, rect);
            hooks.change(made.map((each) => (each.id === step.id ? { ...each, rect, color } as Kept : each)));
        } else hooks.change(made);
        picked = step.type === "cover" ? undefined : step.id;
        hooks.moved();
        paint();
    };
    element.addEventListener("pointerup", (event) => void letGo(event));
    // a drag the browser took away changes nothing
    element.addEventListener("pointercancel", (event) => {
        live = undefined;
        drag = undefined;
        run = undefined;
        fingers.delete(event.pointerId);
        pinch = undefined;
        paint();
    });

    element.addEventListener(
        "wheel",
        (event) => {
            if (!loaded) return;
            event.preventDefault();
            // a pinch on a touchpad comes as the wheel with Ctrl held, in small steps
            zoom(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), pointer(event));
        },
        { passive: false },
    );

    // ---- writing a line of text where the picture was pressed ----
    let writingAt: Point | undefined;
    function startWriting(at: Point) {
        keepWriting();
        writingAt = at;
        const where = toStage({ ...at, width: 0, height: 0 });
        const found = hooks.picture();
        const size = found ? thickness(hooks.pen(), found.original) * 6 : 24;
        Object.assign(writing.style, { left: `${where.x}px`, top: `${where.y}px`, fontSize: `${Math.max(12, size * place().across)}px`, color: hooks.pen().color });
        writing.value = "";
        writing.classList.add("shown");
        writing.focus({ preventScroll: true });
    }
    function keepWriting() {
        const at = writingAt;
        writingAt = undefined;
        writing.classList.remove("shown");
        const found = hooks.picture();
        if (!at || !found || !writing.value.trim()) return;
        const pen = hooks.pen();
        const next = add(found.steps, { type: "text", at, text: writing.value.trim().slice(0, 400), color: pen.color, size: thickness(pen, found.original) * 6 });
        picked = next.at(-1)!.id;
        hooks.change(next);
    }
    writing.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            keepWriting();
            element.focus({ preventScroll: true });
        } else if (event.key === "Escape") {
            event.preventDefault();
            writing.value = "";
            keepWriting();
            element.focus({ preventScroll: true });
        }
        event.stopPropagation();
    });
    writing.addEventListener("blur", () => keepWriting());

    // ---- the keys the stage itself answers, while it has the keyboard ----
    element.addEventListener("keydown", (event) => {
        if (event.target !== element) return;
        if (event.key === " ") {
            spaceHeld = true;
            element.classList.add("panning");
            event.preventDefault();
            return;
        }
        const step = event.shiftKey ? 10 : 1;
        const arrows: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        const by = arrows[event.key];
        if (!by || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        const found = hooks.picture();
        if (tool === "crop" && cropFrame && loaded) cropFrame = dragFrame(cropFrame, "move", by, loaded.size);
        else if (picked && found) {
            const id = picked;
            hooks.change(found.steps.map((each) => (each.id !== id ? each : each.type === "cover" ? { ...each, rect: { ...each.rect, x: each.rect.x + by.x, y: each.rect.y + by.y } } : each.type === "arrow" || each.type === "box" || each.type === "text" ? ({ ...moved(each, by), id } as Kept) : each)));
        } else view = { ...view, x: view.x - by.x * 10, y: view.y - by.y * 10 };
        paint();
    });
    element.addEventListener("keyup", (event) => {
        if (event.key !== " ") return;
        spaceHeld = false;
        element.classList.remove("panning");
    });

    const watcher = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => (sizeOf.width !== element.clientWidth || sizeOf.height !== element.clientHeight ? ((sizeOf = { width: element.clientWidth, height: element.clientHeight }), fitView()) : undefined));
    watcher?.observe(element);

    /** Puts the card's drawing on a fresh canvas, WebGL2 when WebGPU let its device go, and the picture on it again. */
    async function prepare(only?: "WebGL2"): Promise<Loaded | undefined> {
        if (!blob) return undefined;
        const backend = await backendFor(canvas, only);
        if (!backend) {
            hooks.say("Not shown", "This browser cannot draw the picture: it has neither WebGPU nor WebGL2");
            return undefined;
        }
        void backend.lost?.then(() => {
            if (!loaded || only) return;
            const fresh = make("canvas", "quire-img-canvas");
            canvas.replaceWith(fresh);
            canvas = fresh;
            loaded = undefined;
            void prepare("WebGL2").then((again) => ((loaded = again), paint()));
        });
        return loadPicture(backend, blob);
    }

    return {
        element,
        /** Shows a picture: its original, decoded once and put on the card. */
        async show(original: Blob) {
            loaded?.destroy();
            loaded = undefined;
            blob = original;
            loaded = await prepare();
            if (tool === "crop") cropFrame = shown()?.crop;
            fitView();
            return loaded;
        },
        /** Shows nothing. */
        clear() {
            loaded?.destroy();
            loaded = undefined;
            blob = undefined;
            picked = undefined;
            words = [];
            findings = [];
            hover = run = selection = undefined;
            paint();
        },
        /** The words the reader found, and what of them looks private (each finding as the places of its words). */
        setWords(lines: Line[], found: Finding[] = []) {
            words = placeWords(lines);
            const index = new Map<string, number>();
            let at = 0;
            lines.forEach((line, number) => line.words.forEach((_, word) => index.set(`${number},${word}`, at++)));
            findings = found.map((finding) => finding.words.map((place) => index.get(`${place.line},${place.word}`)).filter((each): each is number => each !== undefined));
            hover = run = selection = undefined;
            paint();
        },
        /** The words on the stage. */
        words: () => words,
        /** Hides words by their indices, one cover a stretch of a line, as one change. */
        hideWords,
        /** Hides everything that looks private, as one change. */
        hideFindings: () => hideFindings(),
        /** What looks private and is not yet covered, each thing as the indices of its words. */
        findings: uncovered,
        /** The text selected, or nothing. */
        selected: (): string => (selection ? runText(words, selection[0], selection[1]) : ""),
        /** Selects every word, or none. */
        selectAll(all: boolean) {
            selection = all && words.length ? [0, words.length - 1] : undefined;
            paint();
            hooks.moved();
        },
        loaded: () => loaded,
        tool: () => tool,
        setTool,
        applyCrop,
        aspect: () => aspect,
        setAspect,
        /** The crop's frame as it is being set, in the original's pixels. */
        frame: () => cropFrame,
        /** The step picked, if one is. */
        picked: () => picked,
        pick(id: string | undefined) {
            picked = id;
            paint();
            hooks.moved();
        },
        /** After the steps changed from outside (undo, a version, the steps list): the frame follows the crop and it is drawn again. */
        changed() {
            if (tool === "crop") cropFrame = shown()?.crop;
            if (picked && !hooks.picture()?.steps.some((step) => step.id === picked)) picked = undefined;
            paint();
        },
        fit: fitView,
        oneToOne: () => ((view = oneToOne(view, { x: element.clientWidth / 2, y: element.clientHeight / 2 })), paint()),
        zoom,
        scale: () => view.scale,
        /** How many times the picture has been drawn, for tests. */
        drawn: () => drawn,
        toScreen: (point: Point) => toStage({ ...point, width: 0, height: 0 }),
        destroy() {
            watcher?.disconnect();
            loaded?.destroy();
            element.remove();
        },
    };
}

/** A stage, as the editor holds it. */
export type Stage = ReturnType<typeof createStage>;
