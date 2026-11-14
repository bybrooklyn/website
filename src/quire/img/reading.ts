// Reading the text in a picture, as the editor offers it: the tool, the first time a dialog that asks
// before anything is fetched (what, from where and how big, the three sizes as cards, as dictation
// asks), the download's progress there, and then the reading, quietly, in the tool's strip, while the
// picture can still be used. What was read is kept for the picture while it is open and given to the
// stage; what looks private is found in it (read/private.ts) and offered, never applied by itself.
// The size chosen is remembered in this browser (`quire-img-read`).
//
//   const reading = createReading({ stage, picture, key, say, moved });
//   reading.start(button);   // asks first if no model is kept, then reads

import { filledButton, openDialog, type Dialog } from "../core/dialog";
import { make } from "../core/ui";
import { createReader, type Reader } from "./read/engine";
import { HOST, megabytes, sizeOf, tierOf, TIERS, type Tier } from "./read/models";
import { lookPrivate, type Finding } from "./read/private";
import type { Line } from "./read/words";
import type { Stage } from "./stage";

/** Where the size chosen is kept in this browser. */
export const KEPT = "quire-img-read";

/** Where the reading is: nothing yet, asking, fetching a model, reading, read, or failed. */
export type ReadState = "idle" | "asking" | "fetching" | "reading" | "read" | "failed";

/** What the reading needs of the editor. */
export interface ReadingHooks {
    stage: Stage;
    /** Says which picture is open, so that what was read is kept for it and not shown on another; empty with none. */
    key(): string;
    say(short: string, full: string, tone?: "warn"): void;
    /** Something changed that the bar, the strip and the menus show. */
    moved(): void;
    /** A reader to use in place of the worker, for tests. */
    reader?: Reader;
}

/** The size remembered in this browser, or the smallest. */
export function rememberedTier(): Tier {
    try {
        return tierOf(globalThis.localStorage?.getItem(KEPT));
    } catch {
        return TIERS[0]!;
    }
}

/** What the dialog says first: what reading text needs, where it comes from, and that the picture stays here. */
export const INTRO = "Reading text needs a model, downloaded once from Hugging Face and kept in this browser. It runs on your own machine, and the picture never leaves it.";

/** Says how much of a download is in hand: "3 of 6 MB". */
export const fetchedSaid = (bytes: number, tier: Tier) => `${Math.min(Math.round(bytes / 1e6), Math.round(sizeOf(tier) / 1e6))} of ${megabytes(sizeOf(tier))}`;

/** Builds the reading for an editor. */
export function createReading(hooks: ReadingHooks) {
    let reader = hooks.reader;
    const readerNow = () => (reader ??= createReader());
    let tier = rememberedTier();
    let state: ReadState = "idle";
    let progress = 0;
    let fetched = 0;
    let failure = "";
    // what was read, for the picture it was read from and the size that read it
    let found: { key: string; tier: string; lines: Line[]; findings: Finding[]; ms: number; place: string } | undefined;
    let job: { stop(): void } | undefined;
    let asking: Dialog | undefined;
    const kept = new Map<string, boolean>();

    const set = (next: ReadState) => {
        state = next;
        hooks.moved();
    };
    const remember = (id: string) => {
        try {
            globalThis.localStorage?.setItem(KEPT, id);
        } catch {
            // a browser that keeps nothing starts on the smallest again
        }
    };
    const have = async (each: Tier) => {
        if (!kept.has(each.id)) kept.set(each.id, (await readerNow().have(each.id)).have);
        return kept.get(each.id)!;
    };

    /** Reads the open picture with the size chosen, unless it was read with it already. */
    async function read() {
        const key = hooks.key();
        const bitmap = await hooks.stage.loaded()?.bitmap();
        if (!key || !bitmap) return;
        if (found?.key === key && found.tier === tier.id) {
            bitmap.close();
            return show();
        }
        job?.stop();
        progress = 0;
        set("reading");
        const mine = readerNow().read(bitmap, tier.id, (done) => {
            if (job !== mine) return;
            progress = done;
            hooks.moved();
        });
        job = mine;
        try {
            const done = await mine.done;
            if (job !== mine || hooks.key() !== key) return;
            found = { key, tier: tier.id, lines: done.lines, findings: lookPrivate(done.lines), ms: done.ms, place: done.place };
            job = undefined;
            show();
            const words = done.lines.reduce((sum, line) => sum + line.words.length, 0);
            hooks.say("Read", `Read ${words} ${words === 1 ? "word" : "words"} in ${(done.ms / 1000).toFixed(1)} s, on the ${done.place === "webgpu" ? "graphics card" : "processor"}`);
        } catch (error) {
            if (job !== mine) return;
            job = undefined;
            if (error instanceof Error && error.name === "AbortError") return set("idle");
            failure = error instanceof Error ? error.message : String(error);
            set("failed");
            hooks.say("Not read", `The text could not be read: ${failure}`, "warn");
        }
    }
    function show() {
        hooks.stage.setWords(found?.lines ?? [], found?.findings ?? []);
        set("read");
    }

    /** Fetches the size chosen, with its progress in the dialog, then reads. */
    async function fetchThenRead(dialog?: Dialog) {
        fetched = 0;
        set("fetching");
        try {
            await readerNow().fetch(tier.id, (bytes) => {
                fetched = bytes;
                updateBar();
            });
            kept.set(tier.id, true);
            remember(tier.id);
            void dialog?.close();
            await read();
        } catch (error) {
            const cancelled = error instanceof Error && error.name === "AbortError";
            failure = cancelled ? "" : error instanceof Error ? error.message : String(error);
            set(cancelled ? "idle" : "failed");
            if (dialog?.isOpen()) dialog.change(() => choosing(dialog));
            else if (!cancelled) hooks.say("Not downloaded", `The model was not downloaded: ${failure}`, "warn");
        }
    }

    // ---- the dialog: asked once, before anything is fetched ----
    let bar: HTMLElement | undefined;
    let count: HTMLElement | undefined;
    function updateBar() {
        bar?.style.setProperty("--done", `${Math.round((fetched / sizeOf(tier)) * 100)}%`);
        bar?.setAttribute("aria-valuenow", String(Math.round((fetched / sizeOf(tier)) * 100)));
        if (count) count.textContent = fetchedSaid(fetched, tier);
    }
    const line = (className: string, words: string) => make("p", className, words);

    /** The three sizes as cards, the one chosen pressed, the arrow keys going between them. */
    function cards(): HTMLElement {
        const group = make("div", "quire-img-read-cards");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "Model");
        const all = TIERS.map((each) => {
            const card = make("button", "quire-img-read-card");
            card.type = "button";
            card.dataset.tier = each.id;
            card.setAttribute("role", "radio");
            card.append(make("span", "quire-img-read-card-name", each.name), make("span", "quire-img-read-card-size", kept.get(each.id) ? "On this device" : megabytes(sizeOf(each))), make("span", "quire-img-read-card-who", each.who));
            card.addEventListener("click", () => pick(each));
            return card;
        });
        const pick = (each: Tier, focus = false) => {
            tier = each;
            for (const card of all) {
                const on = card.dataset.tier === each.id;
                card.setAttribute("aria-checked", String(on));
                card.tabIndex = on ? 0 : -1;
                if (on && focus) card.focus();
            }
        };
        group.addEventListener("keydown", (event) => {
            const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            if (!by) return;
            event.preventDefault();
            const at = TIERS.findIndex((each) => each.id === tier.id);
            pick(TIERS[(at + by + TIERS.length) % TIERS.length]!, true);
        });
        pick(tier);
        group.append(...all);
        return group;
    }

    /** The dialog with the three sizes and the button that downloads the one picked. Gives back the cards, which grow out of what was pressed. */
    function choosing(dialog: Dialog): HTMLElement {
        bar = count = undefined;
        const group = cards();
        const parts: HTMLElement[] = [line("quire-img-read-plain", INTRO), group, line("quire-img-read-where", `From ${new URL(HOST).host}: PaddlePaddle's PP-OCRv6, Apache-2.0.`)];
        if (failure) parts.push(line("quire-img-read-warn", `The last try failed: ${failure}`));
        dialog.body.replaceChildren(...parts);
        const quiet = make("button", "quire-dialog-dismiss", "Not now");
        quiet.type = "button";
        quiet.addEventListener("click", () => void dialog.close());
        const go = filledButton(
            "Download and read",
            (pressed) => {
                failure = "";
                dialog.change(() => downloading(dialog), pressed);
                void fetchThenRead(dialog);
            },
            "quire-dialog-action quire-img-read-download",
        );
        dialog.actions.replaceChildren(quiet, go);
        go.focus({ preventScroll: true });
        return group;
    }

    /** The download's progress in place of the buttons, with a way to cancel it. Gives back the progress, which grows out of the button. */
    function downloading(dialog: Dialog): HTMLElement {
        for (const each of dialog.body.querySelectorAll<HTMLButtonElement>(".quire-img-read-card")) each.disabled = true;
        dialog.body.querySelector(".quire-img-read-warn")?.remove();
        const row = make("div", "quire-img-read-progress-row");
        bar = make("div", "quire-img-read-progress");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", "Downloading the model");
        bar.append(make("i"));
        count = make("p", "quire-img-read-count");
        const cancel = make("button", "quire-dialog-dismiss", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => readerNow().cancel());
        row.append(bar, count, cancel);
        dialog.actions.replaceChildren(row);
        updateBar();
        cancel.focus({ preventScroll: true });
        return row;
    }

    /** Opens the dialog out of what was pressed: a line and "Choose" the first time, the sizes at once when changing. */
    function ask(from: HTMLElement | undefined, first: boolean) {
        set("asking");
        asking = openDialog(from, {
            title: "Read text",
            className: "quire-img-read-dialog",
            body: [line("quire-img-read-plain", INTRO)],
            dismiss: "Not now",
            action: { label: "Choose", press: (pressed, dialog) => dialog.change(() => choosing(dialog), pressed) },
            returnTo: hooks.stage.element,
            onClose: () => {
                asking = bar = count = undefined;
                // closing the dialog is saying no to what it was doing
                if (state === "fetching") readerNow().cancel();
                if (state === "asking") set(found?.key === hooks.key() ? "read" : "idle");
            },
        });
        if (!first) asking.change(() => choosing(asking!));
    }

    return {
        /** The tool was chosen: reads the picture, asking first if no model is kept. */
        async start(from?: HTMLElement) {
            if (state === "fetching" || state === "asking") return;
            if (found?.key === hooks.key() && found.tier === tier.id) return show();
            if (await have(tier)) return read();
            // a size remembered but not kept (storage cleared) is asked for again, as the first time
            ask(from, true);
        },
        /** Opens the sizes to choose another; one kept is read with at once. */
        choose(from?: HTMLElement) {
            if (state === "fetching") return;
            ask(from, false);
        },
        /** Changes the size from a menu: read with at once if kept, else asked for. */
        async use(id: string, from?: HTMLElement) {
            const next = tierOf(id);
            tier = next;
            if (await have(next)) {
                remember(next.id);
                return read();
            }
            ask(from, false);
        },
        tier: () => tier,
        state: () => state,
        progress: () => progress,
        /** Whether a size's files are known to be kept in this browser. */
        kept: (id: string) => kept.get(id) ?? false,
        /** What was read from the open picture, if anything. */
        found: () => (found?.key === hooks.key() ? found : undefined),
        failure: () => failure,
        /** The picture changed: what was read from another is not shown, and a reading under way is let go. */
        clear() {
            job?.stop();
            job = undefined;
            if (state === "reading" || state === "read" || state === "failed") state = "idle";
            hooks.stage.setWords([], []);
        },
        destroy() {
            job?.stop();
            void asking?.close();
            reader?.destroy();
        },
    };
}

/** The reading, as the editor holds it. */
export type Reading = ReturnType<typeof createReading>;
