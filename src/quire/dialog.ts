// A dialog, the one kind mdQuire has, for anything that asks before going on, a form of several
// fields, or something to read (dictation's first launch was the first). Which surface a job gets
// is one rule: a form or something to read is a dialog; a single value is one small field at the
// caret or the control; a list to pick from is a menu (ui.ts); something to consult while writing
// (version history, comments, the picture, the outline) is a side panel that starts below the
// bar. The page behind darkens; the dialog is a rounded square with the site's outline, its words,
// and at the bottom the one way the dialog is answered, the same in every dialog: the filled
// button at the right, a quiet cancel to its left, and any other quiet ways before that, one that
// leaves something behind at the far left. Enter in a field does what the filled button does.
// It grows out of the control that was pressed and goes back into it: one skin, laid over the
// control at its place and corners, whose edges move out to the dialog's, with what is inside
// arriving once the skin is nearly there. Focus stays inside it while it is open and goes back to
// the control when it closes; Escape (one step back, as everywhere), a press outside and the
// dialog's own ways out close it. A switch (switchButton) is drawn here too, as every switch in
// mdQuire is. It is the browser's modal <dialog>, so a
// screen reader hears it as a dialog with its title as its name, and the rest of the page is inert.
// One is open at a time: opening another closes the first.
//
//   const dialog = openDialog(button, { title: "Dictation", body: [line], action: { label: "Choose", press } });
//   dialog.change(() => swap(), from);   // the dialog eases to its new size; `from` grows into what replaced it
//   await dialog.close();
//
// The counting (insetOf, rippleFrom, enterAnswers) is pure and tested; the rest is DOM. Its styles are in
// src/styles/quire.css, under "the dialog".

import { composing, EASE, make, MOTION, springCurve, still, type Box } from "./ui";

/** What a dialog holds. */
export interface DialogParts {
    title: string;
    /** What it says and holds, under the title. */
    body: Node[];
    /** The filled button at the bottom. Pressing it leaves the dialog open: `press` closes it if it should. */
    action?: { label: string; press: (button: HTMLButtonElement, dialog: Dialog) => void };
    /** A quieter way out beside the button ("Not now", "Cancel"); it closes the dialog. */
    dismiss?: string;
    /** More quiet buttons before the cancel, such as "Download a copy"; one marked `far` stands alone at the far left, for a way out that leaves something behind ("Leave without saving"). */
    others?: { label: string; press: (dialog: Dialog) => void; far?: boolean }[];
    /** Where focus goes when it closes, when that is not the control it grew from (a line of a menu that has gone). */
    returnTo?: HTMLElement;
    className?: string;
    /** Told once the dialog has closed, however it was closed. */
    onClose?: () => void;
}

/** An open dialog. */
export interface Dialog {
    element: HTMLDialogElement;
    /** Where the body is: what changes while it is open goes here. */
    body: HTMLElement;
    /** The row at the bottom with the filled button. */
    actions: HTMLElement;
    isOpen(): boolean;
    /**
     * Changes what is inside and eases the dialog to its new size. With `from`, an element inside
     * that `update` takes away or replaces, the new thing `update` gives back grows out of where
     * `from` was, its colour fading as it goes, as the "Choose" button becomes the three choices.
     */
    change(update: () => HTMLElement | void, from?: HTMLElement): void;
    close(): Promise<void>;
}

/** How long the dialog takes: it opens on the menus' slight spring, a little slower as it travels further, and closes on the site's easing. */
export const DIALOG = { open: 320, close: 200, change: 260 };

/** The insets, top, right, bottom and left, that cut `outer` down to `inner`; negative where `inner` reaches past it. */
export function insetOf(outer: Box, inner: Box): [number, number, number, number] {
    return [inner.top - outer.top, outer.left + outer.width - (inner.left + inner.width), outer.top + outer.height - (inner.top + inner.height), inner.left - outer.left];
}

/** A ripple for a press at `x`, `y` on a button: its middle there, and large enough to reach the button's farthest corner. */
export function rippleFrom(button: Box, x: number, y: number): { left: number; top: number; size: number } {
    const across = Math.max(x - button.left, button.left + button.width - x);
    const down = Math.max(y - button.top, button.top + button.height - y);
    const size = 2 * Math.hypot(across, down);
    return { left: x - button.left - size / 2, top: y - button.top - size / 2, size };
}

/** Whether Enter in a field of this type answers the dialog: a field of one line does, a box to tick or a button does not. */
export function enterAnswers(type: string): boolean {
    return ["text", "search", "url", "email", "password", "number", "tel", ""].includes(type);
}

/**
 * A switch: a button that is on or off, drawn as every switch in mdQuire is, the pressed square the
 * bar's buttons have when on, with a tick before its words, and its words never its state. Pressing
 * it turns it and tells `change` the new state.
 */
export function switchButton(label: string, on: boolean, change: (on: boolean) => void): HTMLButtonElement & { set(on: boolean): void } {
    const button = make("button", "quire-switch") as HTMLButtonElement & { set(on: boolean): void };
    button.type = "button";
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    tick.setAttribute("viewBox", "0 0 24 24");
    tick.setAttribute("aria-hidden", "true");
    tick.setAttribute("class", "quire-switch-tick");
    tick.innerHTML = '<path d="m6 12.5 4 4 8-9"/>';
    button.append(tick, make("span", "quire-switch-label", label));
    button.set = (next: boolean) => {
        button.setAttribute("aria-pressed", String(next));
        button.classList.toggle("on", next);
    };
    button.set(on);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
        const next = button.getAttribute("aria-pressed") !== "true";
        button.set(next);
        change(next);
    });
    return button;
}

const boxOf = (element: Element): Box => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
};
const px = (inset: number[]) => inset.map((each) => `${each}px`).join(" ");

let current: Dialog | undefined;

/** The filled button, whose press spreads from where it was pressed. */
export function filledButton(label: string, press: (button: HTMLButtonElement) => void, className = "quire-dialog-action"): HTMLButtonElement {
    const button = make("button", className, label);
    button.type = "button";
    button.addEventListener("pointerdown", (event) => {
        if (still()) return;
        const at = rippleFrom(boxOf(button), event.clientX, event.clientY);
        const ripple = make("span", "quire-ripple");
        Object.assign(ripple.style, { left: `${at.left}px`, top: `${at.top}px`, width: `${at.size}px`, height: `${at.size}px` });
        button.append(ripple);
        const gone = () => ripple.remove();
        ripple.animate([{ scale: 0, opacity: 0.35 }, { scale: 1, opacity: 0 }], { duration: 520, easing: EASE }).finished.then(gone, gone);
    });
    button.addEventListener("click", () => press(button));
    return button;
}

/** Opens a dialog out of `from`, the control that was pressed (or out of the middle of the window, with none). */
export function openDialog(from: HTMLElement | undefined, parts: DialogParts): Dialog {
    void current?.close();
    const element = make("dialog", `quire-dialog ${parts.className ?? ""}`.trim());
    const skin = make("div", "quire-dialog-skin");
    const inner = make("div", "quire-dialog-in");
    const title = make("h2", "quire-dialog-title", parts.title);
    title.id = `quire-dialog-${Math.random().toString(36).slice(2)}`;
    element.setAttribute("aria-labelledby", title.id);
    const body = make("div", "quire-dialog-body");
    body.append(...parts.body);
    const actions = make("div", "quire-dialog-actions");
    inner.append(title, body, actions);
    element.append(skin, inner);
    let open = true;
    let closing: Promise<void> | undefined;
    const moving: Animation[] = [];
    const halt = () => {
        for (const each of moving.splice(0)) each.cancel();
    };

    const dialog: Dialog = {
        element,
        body,
        actions,
        isOpen: () => open,
        change(update, grower) {
            const before = boxOf(element);
            const was = grower?.isConnected ? boxOf(grower) : undefined;
            const shade = grower ? getComputedStyle(grower).backgroundColor : "";
            const radius = grower ? getComputedStyle(grower).borderRadius : "";
            const made = update();
            if (still() || !open) return;
            const after = boxOf(element);
            halt();
            // the skin starts at the old size and eases to the new, the dialog staying in the middle
            const from = insetOf(after, before);
            moving.push(
                skin.animate([{ inset: px(from) }, { inset: "0px" }], { duration: DIALOG.change, easing: EASE }),
                // what is inside is shown as far as the skin has reached, so that nothing new stands outside it
                inner.animate([{ clipPath: `inset(${px(from.map((each) => Math.max(0, each)))} round 1.1rem)` }, { clipPath: "inset(0px round 1.1rem)" }], { duration: DIALOG.change, easing: EASE }),
            );
            if (!made || !was) return;
            // what replaced the pressed thing grows out of where it was, in its colour, which fades as it goes
            const to = boxOf(made);
            const sweep = make("div", "quire-dialog-sweep");
            sweep.style.background = shade;
            inner.append(sweep);
            const local = (box: Box) => ({ left: `${box.left - after.left}px`, top: `${box.top - after.top}px`, width: `${box.width}px`, height: `${box.height}px` });
            const gone = () => sweep.remove();
            sweep.animate([{ ...local(was), borderRadius: radius, opacity: 1 }, { ...local(to), borderRadius: "0.75rem", opacity: 0 }], { duration: DIALOG.change + 80, easing: EASE, fill: "both" }).finished.then(gone, gone);
            made.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DIALOG.change, delay: DIALOG.change * 0.3, easing: EASE, fill: "backwards" });
        },
        close() {
            if (closing) return closing;
            open = false;
            if (current === dialog) current = undefined;
            const showing = element.open;
            const here = boxOf(element);
            const focused = element.contains(document.activeElement);
            halt();
            // the page is live again the moment closing starts, so that a press or a key at once is not lost: the
            // browser's dialog is closed now, and what is seen going back into the control is drawn where it was
            if (showing) element.close();
            const goBack = parts.returnTo?.isConnected ? parts.returnTo : from;
            if (goBack?.isConnected && (focused || document.activeElement === document.body)) goBack.focus({ preventScroll: true });
            parts.onClose?.();
            let shade: HTMLElement | undefined;
            const finish = () => {
                halt();
                shade?.remove();
                element.remove();
            };
            if (still() || !showing) {
                finish();
                return (closing = Promise.resolve());
            }
            element.classList.add("closing");
            Object.assign(element.style, { left: `${here.left}px`, top: `${here.top}px`, width: `${here.width}px`, height: `${here.height}px` });
            shade = make("div", "quire-dialog-shade");
            element.before(shade);
            const back = from?.isConnected && from.getClientRects().length ? boxOf(from) : { left: here.left + here.width / 2 - 20, top: here.top + here.height / 2 - 20, width: 40, height: 40 };
            const corners = from ? getComputedStyle(from).borderRadius : "1rem";
            const time = DIALOG.close;
            moving.push(
                skin.animate([{ inset: "0px" }, { inset: px(insetOf(here, back)), borderRadius: corners }], { duration: time, easing: EASE, fill: "forwards" }),
                inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: time * 0.5, easing: "ease-in", fill: "forwards" }),
                shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: time, easing: "ease-in", fill: "forwards" }),
            );
            closing = Promise.all(moving.map((each) => each.finished)).then(finish, finish);
            return closing;
        },
    };

    const quietButton = (label: string, press: () => void) => {
        const quiet = make("button", "quire-dialog-dismiss", label);
        quiet.type = "button";
        quiet.addEventListener("click", press);
        return quiet;
    };
    for (const other of parts.others ?? []) {
        const quiet = quietButton(other.label, () => other.press(dialog));
        if (other.far) quiet.classList.add("far");
        actions.append(quiet);
    }
    if (parts.dismiss) actions.append(quietButton(parts.dismiss, () => void dialog.close()));
    let primary: HTMLButtonElement | undefined;
    if (parts.action) {
        const action = parts.action;
        primary = filledButton(action.label, (pressed) => action.press(pressed, dialog));
        primary.autofocus = true;
        actions.append(primary);
    }
    // Enter in a field of one line answers the dialog as its filled button does, unless the field took the key itself
    element.addEventListener("keydown", (event) => {
        const field = event.target;
        if (event.key !== "Enter" || event.defaultPrevented || composing(event) || event.shiftKey || !(field instanceof HTMLInputElement) || !enterAnswers(field.type)) return;
        const button = actions.querySelector<HTMLButtonElement>(".quire-dialog-action");
        if (!button || button.disabled) return;
        event.preventDefault();
        button.click();
    });

    // Escape asks to close: the dialog goes back into its control rather than vanishing
    element.addEventListener("cancel", (event) => {
        event.preventDefault();
        void dialog.close();
    });
    // closed by the browser on its own (a second Escape it will not let be held back), it is tidied away
    element.addEventListener("close", () => {
        if (open) void dialog.close();
    });
    // a press on the darkened page outside the dialog closes it; the press must start and end outside, so that a drag out of a field does not
    let downOutside = false;
    const outside = (event: PointerEvent | MouseEvent) => {
        const box = boxOf(element);
        return event.target === element && (event.clientX < box.left || event.clientX > box.left + box.width || event.clientY < box.top || event.clientY > box.top + box.height);
    };
    element.addEventListener("pointerdown", (event) => (downOutside = outside(event)));
    element.addEventListener("click", (event) => {
        if (downOutside && outside(event)) void dialog.close();
        downOutside = false;
    });
    // Tab goes round what is in the dialog and nowhere else, not even the browser's own bar
    element.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const stops = [...element.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((each) => !(each as HTMLButtonElement).disabled && each.getClientRects().length);
        if (!stops.length) return;
        event.preventDefault();
        const at = stops.indexOf(document.activeElement as HTMLElement);
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]!.focus();
    });

    document.body.append(element);
    element.showModal();
    current = dialog;
    if (!still()) {
        // the skin is laid over the control, at its place and corners, and its edges move out to the dialog's
        const here = boxOf(element);
        const start = from?.isConnected && from.getClientRects().length ? boxOf(from) : { left: here.left + here.width / 2 - 20, top: here.top + here.height / 2 - 20, width: 40, height: 40 };
        const corners = from ? getComputedStyle(from).borderRadius : "1rem";
        const far = Math.hypot(start.left - here.left, start.top - here.top);
        const time = Math.round(DIALOG.open + Math.min(120, far / 8));
        moving.push(
            skin.animate([{ inset: px(insetOf(here, start)), borderRadius: corners }, { inset: "0px" }], { duration: time, easing: springCurve(MOTION.bounce) }),
            inner.animate([{ opacity: 0, translate: "0 0.4rem" }, { opacity: 1, translate: "0 0" }], { duration: time * 0.6, delay: time * 0.35, easing: EASE, fill: "backwards" }),
            element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: time, pseudoElement: "::backdrop", easing: "ease-out" }),
        );
        void Promise.all(moving.map((each) => each.finished)).then(() => open && halt(), () => {});
    }
    return dialog;
}
