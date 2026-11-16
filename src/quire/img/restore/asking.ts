// Choosing how to repair a JPEG or enlarge a picture, in the reading dialog's family: a dialog grown from what
// was pressed says what a model is (downloaded once from Hugging Face, kept in this browser, run on this
// machine, the picture never leaving it), then the ways as cards, three in a row: the way that needs no model
// first (the hand-written repair, or the resize's own filter), then the model sizes this machine runs, each with
// what it costs to fetch ("On this device" once kept) and who it suits. Download and repair (or enlarge) fetches
// the model chosen, its progress in the buttons' place with Cancel. Nothing is fetched until she says so. The
// choice is remembered in this browser, one for each job.
//
//   const asking = createRestoreAsking({ restorer, returnTo, job: "repair" });
//   const way = await asking.choose(button);     the model's id, "" for the way with no model, or undefined when let go

import { filledButton, openDialog, type Dialog } from "../../core/dialog";
import { lowered } from "../../core/bench";
import { make } from "../../core/ui";
import { graphicsCard } from "../../core/onnx";
import { HOST, megabytes } from "../read/models";
import type { Restorer } from "./engine";
import { placeFor } from "./engine";
import { ENLARGE_MODELS, REPAIR_MODELS, type RestoreModel } from "./models";

/** What each job's dialog says and does. */
const JOBS = {
    repair: {
        kept: "quire-img-repair",
        title: "Repair JPEG",
        intro: "A model repairs more than the instant way does. It is downloaded once from Hugging Face and kept in this browser. It runs on your own machine, and the picture never leaves it.",
        plain: { name: "Instant", who: "Blocks and ringing taken out, in a moment" },
        go: "download and repair",
        use: "repair",
        models: () => REPAIR_MODELS,
    },
    enlarge: {
        kept: "quire-img-enlarge",
        title: "Enlarge",
        intro: "A model enlarges a picture more sharply than a filter does. It is downloaded once from Hugging Face and kept in this browser. It runs on your own machine, and the picture never leaves it.",
        plain: { name: "Filter", who: "The resize filter, smooth and quick" },
        go: "download and enlarge",
        use: "enlarge",
        models: () => ENLARGE_MODELS,
    },
} as const;

/** The job a dialog is for. */
export type RestoreJob = keyof typeof JOBS;

/** The way remembered for a job in this browser: a model's id, "" for the way with no model, or undefined when none was chosen yet. */
export function rememberedWay(job: RestoreJob): string | undefined {
    try {
        const said = globalThis.localStorage?.getItem(JOBS[job].kept);
        return said === null || said === undefined ? undefined : said;
    } catch {
        return undefined;
    }
}

/** The models of a job this machine runs: on a graphics card those that run right there, else those that run in good time on WebAssembly. */
export const modelsHere = (job: RestoreJob, card: boolean, quality?: number): RestoreModel[] => JOBS[job].models().filter((each) => placeFor(each, card) !== undefined && (!each.mostQuality || quality === undefined || quality <= each.mostQuality));

/** Builds the asking for one job, over the restorer (the models' worker). */
export function createRestoreAsking(hooks: { restorer(): Restorer; returnTo(): HTMLElement | undefined; job: RestoreJob; moved?(): void; quality?(): number | undefined }) {
    const job = JOBS[hooks.job];
    const kept = new Map<string, boolean>();
    let card: boolean | undefined;
    const have = async (each: RestoreModel) => {
        if (!kept.has(each.id)) kept.set(each.id, await hooks.restorer().have(each.id).catch(() => false));
        return kept.get(each.id)!;
    };
    const remember = (id: string) => {
        try {
            globalThis.localStorage?.setItem(job.kept, id);
        } catch {
            // a browser that keeps nothing asks again next time
        }
    };
    const offered = async () => {
        card ??= await graphicsCard().catch(() => false);
        return modelsHere(hooks.job, card, hooks.quality?.());
    };

    /** The dialog: the ways as cards, and the model fetched when told. Answers the way chosen, or undefined when let go. */
    async function ask(from: HTMLElement | undefined, startOn: string): Promise<string | undefined> {
        const models = await offered();
        await Promise.all(models.map((each) => have(each)));
        return new Promise((answer) => {
            let chosen = models.some((each) => each.id === startOn) ? startOn : "";
            let result: string | undefined;
            let fetched = 0;
            let fetching = false;
            let bar: HTMLElement | undefined;
            let count: HTMLElement | undefined;
            const modelOf = (id: string) => models.find((each) => each.id === id);
            const update = () => {
                const size = modelOf(chosen)?.bytes ?? 1;
                const share = Math.round((fetched / size) * 100);
                bar?.style.setProperty("--done", `${share}%`);
                bar?.setAttribute("aria-valuenow", String(share));
                if (count) count.textContent = `${Math.min(Math.round(fetched / 1e6), Math.round(size / 1e6))} of ${megabytes(size)}`;
            };
            let action: HTMLButtonElement | undefined;
            const label = () => (modelOf(chosen) && !kept.get(chosen) ? job.go : job.use);
            const go = (pressed: HTMLButtonElement) => {
                if (!modelOf(chosen) || kept.get(chosen)) {
                    result = chosen;
                    remember(chosen);
                    return void dialog.close();
                }
                dialog.change(() => downloading(dialog), pressed);
                void fetchIt(dialog);
            };
            const bodyOf = (failure = "") => {
                const credits = models.map((each) => `${each.name}, ${each.credit} (${each.license})`).join("; ");
                const parts: HTMLElement[] = [make("p", "quire-img-read-plain", job.intro), cards(), make("p", "quire-img-read-where", models.length ? `From ${new URL(HOST).host}: ${credits}.` : "This browser gives no graphics card, so only the way with no model is offered here.")];
                if (failure) parts.push(make("p", "quire-img-read-warn", `The last try failed: ${failure}`));
                return parts;
            };
            const cards = () => {
                const group = make("div", models.length === 1 ? "quire-img-read-cards quire-img-find-cards" : "quire-img-read-cards");
                group.setAttribute("role", "radiogroup");
                group.setAttribute("aria-label", "Way");
                const ways = [{ id: "", name: job.plain.name, size: "No download", who: job.plain.who }, ...models.map((each) => ({ id: each.id, name: each.name, size: kept.get(each.id) ? "On this device" : megabytes(each.bytes), who: each.who }))];
                const all = ways.map((each) => {
                    const button = make("button", "quire-img-read-card");
                    button.type = "button";
                    button.dataset.tier = each.id || "plain";
                    button.setAttribute("role", "radio");
                    button.append(make("span", "quire-img-read-card-name", lowered(each.name)), make("span", "quire-img-read-card-size", each.size), make("span", "quire-img-read-card-who", each.who));
                    button.addEventListener("click", () => pick(each.id));
                    return button;
                });
                const pick = (id: string, focus = false) => {
                    chosen = id;
                    for (const button of all) {
                        const on = button.dataset.tier === (id || "plain");
                        button.setAttribute("aria-checked", String(on));
                        button.tabIndex = on ? 0 : -1;
                        if (on && focus) button.focus();
                    }
                    if (action) action.textContent = label();
                };
                group.addEventListener("keydown", (event) => {
                    const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                    if (!by) return;
                    event.preventDefault();
                    const at = ways.findIndex((each) => each.id === chosen);
                    pick(ways[(at + by + ways.length) % ways.length]!.id, true);
                });
                pick(chosen);
                group.append(...all);
                return group;
            };
            // after a failed download: the cards again, with what went wrong under them
            const choosing = (dialog: Dialog, failure: string): HTMLElement => {
                bar = count = undefined;
                const parts = bodyOf(failure);
                dialog.body.replaceChildren(...parts);
                const quiet = make("button", "quire-dialog-dismiss", "not now");
                quiet.type = "button";
                quiet.addEventListener("click", () => void dialog.close());
                action = filledButton(label(), go, "quire-dialog-action quire-restore-go");
                dialog.actions.replaceChildren(quiet, action);
                action.focus({ preventScroll: true });
                return parts[1]!;
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
                cancel.addEventListener("click", () => hooks.restorer().cancel());
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
                    await hooks.restorer().fetch(chosen, (bytes) => ((fetched = bytes), update()));
                    kept.set(chosen, true);
                    result = chosen;
                    remember(chosen);
                    void dialog.close();
                } catch (error) {
                    const cancelled = error instanceof Error && error.name === "AbortError";
                    if (dialog.isOpen()) dialog.change(() => choosing(dialog, cancelled ? "" : error instanceof Error ? error.message : String(error)));
                } finally {
                    fetching = false;
                }
            };
            // straight to the cards: the choice is the whole question, and what a model is stands above them
            const dialog: Dialog = openDialog(from, {
                title: job.title,
                className: "quire-img-read-dialog quire-img-find-dialog quire-restore-dialog",
                body: bodyOf(),
                dismiss: "not now",
                action: { label: label(), press: (pressed) => go(pressed) },
                returnTo: hooks.returnTo(),
                onClose: () => {
                    if (fetching) hooks.restorer().cancel();
                    hooks.moved?.();
                    answer(result);
                },
            });
            action = dialog.actions.querySelector<HTMLButtonElement>(".quire-dialog-action") ?? undefined;
        });
    }

    return {
        /** The way remembered, if the machine still offers it: a model's id, or "" for the way with no model. */
        async way(): Promise<string | undefined> {
            const said = rememberedWay(hooks.job);
            if (said === undefined) return undefined;
            if (said === "") return "";
            return (await offered()).some((each) => each.id === said) ? said : undefined;
        },
        /** Whether a model is kept, asking the worker once. */
        have: (id: string) => {
            const each = JOBS[hooks.job].models().find((model) => model.id === id);
            return each ? have(each) : Promise.resolve(false);
        },
        /** The dialog; the way chosen, its model kept, or undefined when let go. */
        choose: (from?: HTMLElement, startOn = rememberedWay(hooks.job) ?? "") => ask(from, startOn),
        /** The models this machine is offered. */
        offered,
    };
}

/** An asking, as the editor holds it. */
export type RestoreAsking = ReturnType<typeof createRestoreAsking>;
