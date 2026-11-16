// Asking before the cut-out's model is fetched, in the reading dialog's family: the first time, a dialog
// grown from what was pressed says what is needed (a model, downloaded once from Hugging Face and kept
// in this browser, run on this machine, the picture never leaving it) and shows the two qualities as
// cards in the same step (quick and best, each with its size and who it suits, "On this device" once
// kept); "download and cut out" fetches it, its progress in the buttons' place with "cancel". The
// quality is remembered (`quire-cutout`). Nothing is fetched until she says so; after that there is no
// dialog. A quality picked by name (`use`) is asked for alone, and only if it is not kept. The same
// asks once for the model that picks a subject by a press. What is pressed is written in lowercase,
// as the site's own labels are.
//
//   const asking = createAsking({ finder, returnTo });
//   if (await asking.ready(button)) ... the model is kept

import { filledButton, openDialog, type Dialog } from "../../core/dialog";
import { make } from "../../core/ui";
import { HOST, megabytes } from "../read/models";
import type { Finder } from "../parts/finder";
import { CUT_RENAMED, CUT_TIERS, partSize, PART_TIERS, type PartTier } from "../parts/models";

/** Where the quality chosen is kept in this browser. */
export const KEPT_CUT = "quire-cutout";

/** What the dialog says first. */
export const CUT_INTRO = "Cutting out needs a model, downloaded once from Hugging Face and kept in this browser. It runs on your own machine, and the picture never leaves it.";
/** What it says before the model that picks a subject by a press is fetched. */
export const PICK_INTRO = "Pressing a thing to keep it needs one more model, downloaded once from Hugging Face and kept in this browser.";

/** The quality remembered in this browser from a past visit, if one is. */
export function rememberedCut(): PartTier | undefined {
    try {
        const kept = globalThis.localStorage?.getItem(KEPT_CUT);
        // the old Better (ormbg) is the new Best by another name; the old Best (BiRefNet) is gone, and its id is Best's
        const id = (kept && CUT_RENAMED[kept]) ?? kept;
        return CUT_TIERS.find((tier) => tier.id === id);
    } catch {
        return undefined;
    }
}

/** The quality to start on: the one remembered, else Best (about 20 seconds a picture; Quick, under a second, is made for people). */
export const startingCut = (remembered = rememberedCut()): PartTier => remembered ?? CUT_TIERS.find((tier) => tier.id === "cut-best")!;

/** Builds the asking, over a finder (the part models' worker, which the cut-out shares). */
export function createAsking(hooks: { finder(): Finder; returnTo(): HTMLElement | undefined; moved?(): void }) {
    let tier = rememberedCut() ?? CUT_TIERS[1]!;
    let chosenByMachine = !rememberedCut();
    const kept = new Map<string, boolean>();
    let fetching = false;
    const have = async (each: PartTier) => {
        if (!kept.has(each.id)) kept.set(each.id, await hooks.finder().have(each.id).catch(() => false));
        return kept.get(each.id)!;
    };
    const remember = (id: string) => {
        try {
            globalThis.localStorage?.setItem(KEPT_CUT, id);
        } catch {
            // a browser that keeps nothing starts on Quick again
        }
    };

    /** Asks with a dialog, and fetches the choice when told: true once it is kept. `choices` is the cards offered; one choice is asked for plainly, with no cards. */
    function ask(from: HTMLElement | undefined, choices: PartTier[], title: string, intro: string, go: string): Promise<boolean> {
        return new Promise((answer) => {
            let done = false;
            let fetched = 0;
            let bar: HTMLElement | undefined;
            let count: HTMLElement | undefined;
            const update = () => {
                const share = Math.round((fetched / partSize(tier)) * 100);
                bar?.style.setProperty("--done", `${share}%`);
                bar?.setAttribute("aria-valuenow", String(share));
                if (count) count.textContent = `${Math.min(Math.round(fetched / 1e6), Math.round(partSize(tier) / 1e6))} of ${megabytes(partSize(tier))}`;
            };
            const cards = () => {
                // the two qualities stand two in a row, each card its usual size, as Find's two do
                const group = make("div", choices.length === 2 ? "quire-img-read-cards quire-img-find-cards" : "quire-img-read-cards");
                group.setAttribute("role", "radiogroup");
                group.setAttribute("aria-label", "Quality");
                const all = choices.map((each) => {
                    const card = make("button", "quire-img-read-card");
                    card.type = "button";
                    card.dataset.tier = each.id;
                    card.setAttribute("role", "radio");
                    card.append(make("span", "quire-img-read-card-name", each.name.toLowerCase()), make("span", "quire-img-read-card-size", kept.get(each.id) ? "On this device" : megabytes(partSize(each))), make("span", "quire-img-read-card-who", each.who));
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
                    const at = choices.findIndex((each) => each.id === tier.id);
                    pick(choices[(at + by + choices.length) % choices.length]!, true);
                });
                pick(choices.includes(tier) ? tier : choices[0]!);
                group.append(...all);
                return group;
            };
            const choosing = (dialog: Dialog, failure = ""): HTMLElement => {
                bar = count = undefined;
                const group = choices.length > 1 ? cards() : make("p", "quire-img-read-plain", `${choices[0]!.credit}, ${megabytes(partSize(choices[0]!))}.`);
                if (choices.length === 1) tier = choices[0]!;
                const credits = choices.map((each) => each.credit).join("; ");
                const parts: HTMLElement[] = [make("p", "quire-img-read-plain", intro), group, make("p", "quire-img-read-where", `From ${new URL(HOST).host}: ${credits}; Apache-2.0 and MIT.`)];
                if (failure) parts.push(make("p", "quire-img-read-warn", `The last try failed: ${failure}`));
                dialog.body.replaceChildren(...parts);
                const quiet = make("button", "quire-dialog-dismiss", "not now");
                quiet.type = "button";
                quiet.addEventListener("click", () => void dialog.close());
                const button = filledButton(go, (pressed) => {
                    dialog.change(() => downloading(dialog), pressed);
                    void fetchIt(dialog);
                }, "quire-dialog-action quire-cut-download");
                button.autofocus = true;
                dialog.actions.replaceChildren(quiet, button);
                button.focus({ preventScroll: true });
                return group;
            };
            const downloading = (dialog: Dialog): HTMLElement => {
                for (const each of dialog.body.querySelectorAll<HTMLButtonElement>(".quire-img-read-card")) each.disabled = true;
                const row = make("div", "quire-img-read-progress-row");
                bar = make("div", "quire-img-read-progress");
                bar.setAttribute("role", "progressbar");
                bar.setAttribute("aria-label", "Downloading the model");
                bar.append(make("i"));
                count = make("p", "quire-img-read-count");
                const cancel = make("button", "quire-dialog-dismiss", "cancel");
                cancel.type = "button";
                cancel.addEventListener("click", () => hooks.finder().cancel());
                row.append(bar, count, cancel);
                dialog.actions.replaceChildren(row);
                update();
                cancel.focus({ preventScroll: true });
                return row;
            };
            const fetchIt = async (dialog: Dialog) => {
                fetched = 0;
                fetching = true;
                try {
                    if (!(await have(tier))) await hooks.finder().fetch(tier.id, (bytes) => ((fetched = bytes), update()));
                    kept.set(tier.id, true);
                    if (CUT_TIERS.includes(tier)) remember(tier.id);
                    done = true;
                    void dialog.close();
                } catch (error) {
                    const cancelled = error instanceof Error && error.name === "AbortError";
                    if (dialog.isOpen()) dialog.change(() => choosing(dialog, cancelled ? "" : error instanceof Error ? error.message : String(error)));
                } finally {
                    fetching = false;
                }
            };
            // one step: it opens on the choice itself, with what it needs said over it
            openDialog(from, {
                title,
                className: "quire-img-read-dialog quire-img-find-dialog quire-cut-dialog",
                body: [],
                fill: (dialog) => void choosing(dialog),
                returnTo: hooks.returnTo(),
                onClose: () => {
                    if (fetching) hooks.finder().cancel();
                    hooks.moved?.();
                    answer(done);
                },
            });
        });
    }

    // both qualities run on any machine
    const offered = async () => CUT_TIERS;
    return {
        /** The quality in use. */
        tier: () => tier,
        /** True once the quality's model is kept, asking first (once) if it is not. */
        async ready(from?: HTMLElement): Promise<boolean> {
            const choices = await offered();
            // with nothing remembered, it starts on Best
            if (chosenByMachine) {
                tier = startingCut(undefined);
                chosenByMachine = false;
            }
            if (!choices.includes(tier)) tier = choices.at(-1)!;
            for (const each of choices) void have(each);
            if (await have(tier)) return true;
            return ask(from, choices, "Cut out the background", CUT_INTRO, "download and cut out");
        },
        /** Lets her choose another quality: the cards again; true when one is kept and chosen. */
        choose(from?: HTMLElement): Promise<boolean> {
            return offered().then((choices) => ask(from, choices, "Quality", CUT_INTRO, "use this quality"));
        },
        /** Takes a quality by its id: true once its model is kept, asking for that one model first if it is not. Told no, the quality in use is the one it was. */
        async use(id: string, from?: HTMLElement): Promise<boolean> {
            const next = CUT_TIERS.find((each) => each.id === id);
            if (!next) return false;
            const was = tier;
            tier = next;
            chosenByMachine = false;
            if (await have(next)) {
                remember(next.id);
                return true;
            }
            const answer = await ask(from, [next], "Cut out the background", CUT_INTRO, "download and cut out");
            if (!answer) tier = was;
            return answer;
        },
        /** True once the model that picks a subject by a press is kept, asking first if it is not. */
        async picking(from?: HTMLElement): Promise<boolean> {
            const small = PART_TIERS[0]!;
            if (await have(small)) return true;
            const was = tier;
            const answer = await ask(from, [small], "Choose the subject", PICK_INTRO, "download");
            tier = was;
            return answer;
        },
        /** Whether a quality's model is kept, as far as was asked. */
        kept: (id: string) => kept.get(id) ?? false,
    };
}

/** The asking, as the cut-out holds it. */
export type Asking = ReturnType<typeof createAsking>;
