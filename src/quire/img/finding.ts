// Finding a part with a model, as the Grade surface offers it: Find in Parts; the first time a dialog
// grown from the button says what is needed (a model, downloaded once from Hugging Face and kept in
// this browser, run on this machine, the picture never leaving it), with the two choices as cards and
// Download and find, whose progress takes the buttons' place with Cancel. Then presses on the picture
// outline a thing (more presses add to it, an Alt-press takes away), and Subject and Background find
// the picture's subject, or all but it. The choice is remembered in this browser (`quire-img-parts`).
//
//   const finding = createFinding({ ... });
//   finding.start(button);

import { filledButton, openDialog, type Dialog } from "../core/dialog";
import { make } from "../core/ui";
import { megabytes } from "./read/models";
import { HOST } from "./read/models";
import { createFinder, type Finder } from "./parts/finder";
import { partSize, partTierOf, PART_TIERS, type PartTier } from "./parts/models";
import type { Press } from "./parts/segment";
import type { Found } from "./masks";

/** Where the choice is kept in this browser. */
export const KEPT_PARTS = "quire-img-parts";

/** What the dialog says first. */
export const FIND_INTRO = "Finding a thing needs a model, downloaded once from Hugging Face and kept in this browser. It runs on your own machine, and the picture never leaves it.";

/** What finding needs of the editor. */
export interface FindingHooks {
    /** The picture as a bitmap, for the model; and a key saying which picture it is. */
    bitmap(): Promise<ImageBitmap | undefined>;
    key(): string;
    /** What was found for the presses so far: a new part the first time, the same part after. */
    found(found: Found, presses: Press[]): void;
    /** The subject found: as it is, or turned inside out for the background. */
    subject(found: Found, background: boolean): void;
    say(short: string, full: string, tone?: "warn"): void;
    /** Something changed that the strip shows. */
    moved(): void;
    returnTo(): HTMLElement;
    finder?: Finder;
}

/** The choice remembered, or the smaller. */
export function rememberedPartTier(): PartTier {
    try {
        return partTierOf(globalThis.localStorage?.getItem(KEPT_PARTS));
    } catch {
        return PART_TIERS[0]!;
    }
}

/** Builds finding for an editor. */
export function createFinding(hooks: FindingHooks) {
    let finder = hooks.finder;
    const finderNow = () => (finder ??= createFinder());
    let tier = rememberedPartTier();
    let state: "idle" | "asking" | "fetching" | "ready" | "finding" = "idle";
    const kept = new Map<string, boolean>();
    let presses: Press[] = [];
    // the picture whose encoding the worker keeps, so that later presses send no picture
    let sentKey = "";
    let fetched = 0;
    const set = (next: typeof state) => {
        state = next;
        hooks.moved();
    };
    const remember = (id: string) => {
        try {
            globalThis.localStorage?.setItem(KEPT_PARTS, id);
        } catch {
            // a browser that keeps nothing starts on the smaller again
        }
    };
    const have = async (each: PartTier) => {
        if (!kept.has(each.id)) kept.set(each.id, await finderNow().have(each.id));
        return kept.get(each.id)!;
    };

    /** Outlines what the presses so far point at; the picture goes to the worker only the first time. */
    async function press(at: { x: number; y: number }, add: boolean) {
        if (state !== "ready") return;
        presses = [...presses, { x: Math.round(at.x), y: Math.round(at.y), add }];
        const now = presses;
        set("finding");
        try {
            const key = hooks.key();
            const picture = sentKey === key ? undefined : await hooks.bitmap();
            let answer;
            try {
                answer = await finderNow().select(tier.id, key, picture, now);
            } catch (error) {
                // the worker let the picture's encoding go (another choice, a fresh worker): sent again
                if (!(error as { again?: boolean }).again) throw error;
                answer = await finderNow().select(tier.id, key, await hooks.bitmap(), now);
            }
            sentKey = key;
            if (presses === now) hooks.found(answer.found, now);
            hooks.say("Found", `Outlined in ${(answer.ms / 1000).toFixed(1)} s; press to add to it, Alt and press to take away`);
        } catch (error) {
            presses = presses.slice(0, -1);
            hooks.say("Not found", `Nothing was outlined: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
        set("ready");
    }

    /** The subject, or all but it. */
    async function subject(background: boolean) {
        if (state !== "ready") return;
        set("finding");
        try {
            const picture = await hooks.bitmap();
            if (!picture) return set("ready");
            const answer = await finderNow().matte(tier.id, picture);
            presses = [];
            hooks.subject(answer.found, background);
            hooks.say(background ? "Background" : "Subject", `Found in ${(answer.ms / 1000).toFixed(1)} s`);
        } catch (error) {
            hooks.say("Not found", `The subject was not found: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
        set("ready");
    }

    // ---- the dialog: asked once, before anything is fetched ----
    let bar: HTMLElement | undefined;
    let count: HTMLElement | undefined;
    const updateBar = () => {
        const share = Math.round((fetched / partSize(tier)) * 100);
        bar?.style.setProperty("--done", `${share}%`);
        bar?.setAttribute("aria-valuenow", String(share));
        if (count) count.textContent = `${Math.min(Math.round(fetched / 1e6), Math.round(partSize(tier) / 1e6))} of ${megabytes(partSize(tier))}`;
    };
    function cards(): HTMLElement {
        const group = make("div", "quire-img-read-cards quire-img-find-cards");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "Model");
        const all = PART_TIERS.map((each) => {
            const card = make("button", "quire-img-read-card");
            card.type = "button";
            card.dataset.tier = each.id;
            card.setAttribute("role", "radio");
            card.append(make("span", "quire-img-read-card-name", each.name), make("span", "quire-img-read-card-size", kept.get(each.id) ? "On this device" : megabytes(partSize(each))), make("span", "quire-img-read-card-who", each.who));
            card.addEventListener("click", () => pick(each));
            return card;
        });
        const pick = (each: PartTier, focus = false) => {
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
            const at = PART_TIERS.findIndex((each) => each.id === tier.id);
            pick(PART_TIERS[(at + by + PART_TIERS.length) % PART_TIERS.length]!, true);
        });
        pick(tier);
        group.append(...all);
        return group;
    }
    function choosing(dialog: Dialog, failure = ""): HTMLElement {
        bar = count = undefined;
        const group = cards();
        const parts: HTMLElement[] = [make("p", "quire-img-read-plain", FIND_INTRO), group, make("p", "quire-img-read-where", `From ${new URL(HOST).host}: ${PART_TIERS.map((each) => each.credit).join("; ")}, Apache-2.0.`)];
        if (failure) parts.push(make("p", "quire-img-read-warn", `The last try failed: ${failure}`));
        dialog.body.replaceChildren(...parts);
        const quiet = make("button", "quire-dialog-dismiss", "Not now");
        quiet.type = "button";
        quiet.addEventListener("click", () => void dialog.close());
        const go = filledButton("Download and find", (pressed) => {
            dialog.change(() => downloading(dialog), pressed);
            void fetchThenReady(dialog);
        }, "quire-dialog-action quire-img-find-download");
        dialog.actions.replaceChildren(quiet, go);
        go.focus({ preventScroll: true });
        return group;
    }
    function downloading(dialog: Dialog): HTMLElement {
        for (const each of dialog.body.querySelectorAll<HTMLButtonElement>(".quire-img-read-card")) each.disabled = true;
        const row = make("div", "quire-img-read-progress-row");
        bar = make("div", "quire-img-read-progress");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", "Downloading the model");
        bar.append(make("i"));
        count = make("p", "quire-img-read-count");
        const cancel = make("button", "quire-dialog-dismiss", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => finderNow().cancel());
        row.append(bar, count, cancel);
        dialog.actions.replaceChildren(row);
        updateBar();
        cancel.focus({ preventScroll: true });
        return row;
    }
    async function fetchThenReady(dialog: Dialog) {
        fetched = 0;
        set("fetching");
        try {
            await finderNow().fetch(tier.id, (bytes) => {
                fetched = bytes;
                updateBar();
            });
            kept.set(tier.id, true);
            remember(tier.id);
            set("ready");
            void dialog.close();
        } catch (error) {
            const cancelled = error instanceof Error && error.name === "AbortError";
            set("idle");
            if (dialog.isOpen()) dialog.change(() => choosing(dialog, cancelled ? "" : error instanceof Error ? error.message : String(error)));
        }
    }
    let asking: Dialog | undefined;
    function ask(from: HTMLElement | undefined) {
        set("asking");
        asking = openDialog(from, {
            title: "Find a thing",
            className: "quire-img-read-dialog quire-img-find-dialog",
            body: [make("p", "quire-img-read-plain", FIND_INTRO)],
            dismiss: "Not now",
            action: { label: "Choose", press: (pressed, dialog) => dialog.change(() => choosing(dialog), pressed) },
            returnTo: hooks.returnTo(),
            onClose: () => {
                asking = bar = count = undefined;
                if (state === "fetching") finderNow().cancel();
                if (state === "asking") set("idle");
            },
        });
    }

    return {
        /** Find was pressed: ready at once if the choice is kept, else asked first. */
        async start(from?: HTMLElement) {
            if (state === "fetching" || state === "asking") return;
            presses = [];
            if (await have(tier)) return set("ready");
            ask(from);
        },
        /** Finding is let go: presses no longer outline. */
        stop() {
            presses = [];
            if (state === "ready" || state === "finding") set("idle");
        },
        /** A new part is begun by the next press. */
        fresh: () => void (presses = []),
        press,
        subject,
        state: () => state,
        tier: () => tier,
        destroy() {
            void asking?.close();
            finder?.destroy();
        },
    };
}

/** Finding, as the editor holds it. */
export type Finding = ReturnType<typeof createFinding>;
