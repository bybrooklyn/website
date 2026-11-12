// Dictation in the editor: the microphone button, the shortcut, the panel that grows from the
// button, and the words that appear faintly at the cursor while someone speaks. This is the one
// file the editor needs to know:
//
//   const dictation = createDictation(surface);
//   dictation.mount(barElement);        // puts the microphone (and the button for its panel) in a row
//   dictation.items()                   // lines for the three-dot menu
//   dictation.why                       // set, with the reason, when this browser cannot dictate
//
// The button is a switch: pressed, it listens, and it switches itself off after a couple of seconds
// of quiet. The first time, it asks before downloading the speech model, and says how big it is and
// that no sound leaves the machine. The model, the microphone and the recognizing are in other files
// and are given in `options`, so that the browser tests can give a made-up one.

import { closeOthers, flowMenu, make, type Menu, type MenuItem } from "../ui";
import type { Surface } from "../surface";
import "./dictation.css";
import { canListen, MicrophoneError, openMicrophone, type Microphone } from "./capture";
import { canStore, createProvider, type Provider } from "./engine";
import { defaultTier, deviceNow, megabytes, sizeOf, tierOf, TIERS, type Tier } from "./models";
import { startSession, type Recognizer, type Session } from "./session";
import { correct, load as loadWords, save as saveWords, type Custom } from "./words";

/** What the page can give dictation in place of the real things. */
export interface DictationOptions {
    provider?: Provider;
    microphone?: (onFrame: (frame: Float32Array) => void) => Promise<Microphone>;
    /** The reason dictation cannot work here, or nothing if it can. */
    unavailable?: () => string | undefined;
    /** Quiet times in milliseconds, for tests. */
    silence?: number;
    wait?: number;
}

/** Dictation, as the editor holds it. */
export interface Dictation {
    /** The reason there is no dictation here, in a line; undefined when there is. */
    why?: string;
    /** The microphone button, and the one beside it that opens the panel. */
    button: HTMLButtonElement;
    more: HTMLButtonElement;
    /** Puts both buttons in an element. */
    mount(into: HTMLElement): void;
    /** Lines for a menu: the switch, and the panel. */
    items(from: HTMLElement): MenuItem[];
    toggle(): void;
    state(): "off" | "loading" | "listening" | "downloading" | "asking";
    destroy(): void;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const KEY = MAC ? "Cmd+D" : "Ctrl+D";
const KEPT = { tier: "mdquire-dictation-tier", commands: "mdquire-dictation-commands" };
/** How long a model stays in memory after dictation is switched off, so that pressing it again at once is quick. */
const KEEP = 30000;

const svg = (paths: string) => {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("class", "quire-icon");
    icon.innerHTML = paths;
    return icon;
};
const microphoneIcon = () => svg('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6"/>');
const chevronIcon = () => svg('<path d="m7 10 5 5 5-5"/>');

const remembered = (name: string): string | undefined => {
    try {
        return localStorage.getItem(name) ?? undefined;
    } catch {
        return undefined;
    }
};
const remember = (name: string, value: string) => {
    try {
        localStorage.setItem(name, value);
    } catch {
        // the choice lasts until the page is closed
    }
};

/** Why this browser cannot dictate, or nothing if it can. */
export function whyNot(): string | undefined {
    if (typeof WebAssembly === "undefined") return "Dictation needs WebAssembly, which this browser does not have.";
    if (!canListen()) return "Dictation needs a microphone and a browser that can capture sound, and this one cannot.";
    if (!canStore()) return "Dictation needs a browser that can keep files for the speech model, and this one cannot.";
    return undefined;
}

/** Makes dictation for a surface. */
export function createDictation(surface: Surface, options: DictationOptions = {}): Dictation {
    const why = (options.unavailable ?? whyNot)();
    const button = make("button", "quire-button quire-dictate");
    const more = make("button", "quire-button quire-dictate-more");
    let box: Menu | undefined;
    const disabled = why !== undefined;
    if (!disabled) return build();
    // without dictation the control is not drawn, and the reason is a line for the menu
    return {
        why,
        button,
        more,
        mount() {},
        items: () => [{ label: why, note: true, run() {} }],
        toggle() {},
        state: () => "off",
        destroy() {},
    };

    function build(): Dictation {
        const provider = options.provider ?? createProvider();
        const microphone = options.microphone ?? openMicrophone;
        let state: ReturnType<Dictation["state"]> = "off";
        let tierId = remembered(KEPT.tier) ?? defaultTier(deviceNow());
        let commands = remembered(KEPT.commands) !== "off";
        let custom: Custom = loadWords();
        let used = 0;
        const cached = new Map<string, boolean>();
        let progress = { bytes: 0, total: 0 };
        let message = "";
        let note = "";
        let speaking = "";
        let session: Session | undefined;
        let mic: Microphone | undefined;
        let recognizer: Recognizer | undefined;
        let loadMs = 0;
        let release: ReturnType<typeof setTimeout> | undefined;
        let view: "main" | "words" = "main";
        let starting = 0;

        const tier = (): Tier => tierOf(tierId);
        const panel = make("div", "quire-dictation");
        const live = make("p", "quire-sr");
        live.setAttribute("role", "status");
        const ghost = make("div", "quire-ghost");
        ghost.setAttribute("aria-hidden", "true");
        document.body.append(live, ghost);

        // ---- the buttons ----
        button.type = more.type = "button";
        button.setAttribute("aria-pressed", "false");
        const meter = make("span", "quire-meter");
        meter.append(make("i"), make("i"), make("i"));
        button.append(microphoneIcon(), meter);
        more.append(chevronIcon());
        more.setAttribute("aria-haspopup", "dialog");
        more.setAttribute("aria-label", "Dictation settings");
        more.title = "Dictation settings";
        for (const each of [button, more]) each.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => toggle());
        more.addEventListener("click", () => (box?.isOpen() ? box.close(true) : openPanel(more)));

        const label = () => {
            const words = state === "listening" ? "Stop dictation" : state === "loading" || state === "downloading" ? "Dictation is getting ready" : "Start dictation";
            button.setAttribute("aria-label", `${words} (${KEY})`);
            button.title = `${words} (${KEY})`;
            button.setAttribute("aria-pressed", String(state === "listening" || state === "loading"));
            button.dataset.state = state;
            button.classList.toggle("listening", state === "listening");
            button.classList.toggle("busy", state === "loading" || state === "downloading");
        };
        label();

        const setState = (next: ReturnType<Dictation["state"]>) => {
            state = next;
            label();
            render();
        };
        const say = (text: string) => {
            message = text;
            live.textContent = text;
            render();
        };

        // ---- the words shown faintly at the cursor ----
        const place = () => {
            if (!speaking) return;
            const selected = getSelection();
            const range = selected && selected.rangeCount > 0 && surface.element.contains(selected.anchorNode) ? selected.getRangeAt(0).cloneRange() : undefined;
            let rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
            const column = surface.element.getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) rect = new DOMRect(column.left, column.top, 0, 28);
            ghost.style.left = `${column.left}px`;
            ghost.style.top = `${rect.top}px`;
            ghost.style.width = `${column.width}px`;
            ghost.style.textIndent = `${Math.max(0, rect.left - column.left)}px`;
            ghost.style.lineHeight = `${Math.max(rect.height, 20)}px`;
        };
        const showWords = (text: string) => {
            speaking = text;
            ghost.textContent = text;
            ghost.classList.toggle("shown", text !== "");
            place();
        };
        const follow = () => place();
        addEventListener("scroll", follow, true);
        addEventListener("resize", follow);
        const unselect = surface.on("select", follow);

        // ---- starting and stopping ----
        function toggle() {
            if (state === "listening" || state === "loading") return void stop("button");
            if (state === "downloading") return;
            void start();
        }

        async function start() {
            const mine = ++starting;
            clearTimeout(release);
            message = note = "";
            if (!recognizer) {
                const wanted = tier();
                if (!(await provider.cached(wanted))) {
                    cached.set(wanted.id, false);
                    setState("asking");
                    openPanel(button);
                    return;
                }
                cached.set(wanted.id, true);
                setState("loading");
                const loaded = await provider.load(wanted).then(
                    (made) => made,
                    (error: Error) => {
                        say(`The model could not be loaded: ${error.message}`);
                        return undefined;
                    },
                );
                if (!loaded) return void setState("off");
                if (mine !== starting) return void loaded.recognizer.dispose();
                recognizer = loaded.recognizer;
                loadMs = loaded.ms;
            } else setState("loading");
            try {
                mic = await microphone((frame) => session?.feed(frame));
            } catch (error) {
                say(error instanceof MicrophoneError || error instanceof Error ? error.message : "The microphone could not be opened.");
                return void setState("off");
            }
            if (mine !== starting) return void mic.close();
            session = startSession({
                target: surface,
                recognizer,
                commands: () => commands,
                custom: () => custom,
                silence: options.silence,
                wait: options.wait,
                onLevel: (level) => button.style.setProperty("--level", level.toFixed(2)),
                onProvisional: showWords,
                onNote: (text) => {
                    note = text;
                    render();
                },
                onStop: (reason) => void ended(reason),
            });
            surface.focus();
            setState("listening");
            live.textContent = "Dictation is on";
        }

        /** Dictation has stopped: the microphone is closed at once, the model a little later. */
        async function ended(reason: string) {
            mic?.close();
            mic = undefined;
            session = undefined;
            button.style.setProperty("--level", "0");
            showWords("");
            const why = reason === "silence" ? "Dictation switched itself off after a quiet moment." : reason === "nothing" ? "Dictation switched itself off because nothing was said." : reason === "command" ? "Dictation stopped." : reason === "error" ? message || "Dictation stopped." : "";
            if (why) say(why);
            else live.textContent = "Dictation is off";
            setState("off");
            clearTimeout(release);
            // the model is let go soon after, which gives back the memory it held
            release = setTimeout(() => {
                recognizer?.dispose();
                recognizer = undefined;
            }, KEEP);
        }

        function stop(reason: "button") {
            starting++;
            if (session) void session.stop(reason);
            else void ended(reason);
        }

        // ---- the shortcut ----
        const onKey = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "d" || event.shiftKey || event.altKey) return;
            if (MAC ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
        };
        surface.element.addEventListener("keydown", onKey, true);

        // ---- downloading ----
        async function download() {
            const wanted = tier();
            progress = { bytes: 0, total: sizeOf(wanted) };
            say("");
            setState("downloading");
            try {
                await provider.download(wanted, (bytes) => {
                    progress.bytes = bytes;
                    updateProgress();
                });
            } catch (error) {
                const stopped = (error as { cancelled?: boolean }).cancelled;
                say(stopped ? "The download was cancelled. What arrived is kept, and it carries on from there next time." : `The download failed: ${(error as Error).message}. What arrived is kept, and it carries on from there next time.`);
                return void setState("off");
            }
            cached.set(wanted.id, true);
            void navigator.storage?.persist?.().catch(() => {});
            await refresh();
            await start();
        }

        async function refresh() {
            for (const each of TIERS) cached.set(each.id, await provider.cached(each).catch(() => false));
            used = await provider.used().catch(() => 0);
            render();
        }

        // ---- the panel ----
        let bar: HTMLElement | undefined;
        let text: HTMLElement | undefined;
        function updateProgress() {
            if (bar) bar.style.setProperty("--done", `${Math.min(100, (progress.bytes / Math.max(1, progress.total)) * 100).toFixed(1)}%`);
            if (text) text.textContent = `${megabytes(progress.bytes)} of ${megabytes(progress.total)}`;
        }

        function line(className: string, words: string) {
            return make("p", className, words);
        }
        function action(name: string, run: () => void, className = "quire-dictation-action") {
            const each = make("button", `quire-button ${className}`, name);
            each.type = "button";
            each.addEventListener("click", run);
            return each;
        }

        function render() {
            if (view === "words") return;
            const wanted = tier();
            const parts: HTMLElement[] = [];
            parts.push(make("h2", "quire-dictation-title", "Dictation"));

            // which model
            const choices = make("div", "quire-dictation-tiers");
            choices.setAttribute("role", "radiogroup");
            choices.setAttribute("aria-label", "Speech model");
            for (const each of TIERS) {
                const choice = make("button", "quire-dictation-tier");
                choice.type = "button";
                choice.setAttribute("role", "radio");
                choice.setAttribute("aria-checked", String(each.id === tierId));
                choice.disabled = state === "downloading" || state === "loading" || state === "listening";
                choice.append(make("span", "quire-dictation-tier-name", each.name), make("span", "quire-dictation-tier-size", cached.get(each.id) ? "on this device" : megabytes(sizeOf(each))), make("span", "quire-dictation-tier-note", each.note));
                choice.addEventListener("click", () => {
                    tierId = each.id;
                    remember(KEPT.tier, tierId);
                    render();
                });
                choices.append(choice);
            }
            parts.push(choices);

            if (state === "asking") {
                parts.push(line("quire-dictation-plain", `Dictation needs a speech model of ${megabytes(sizeOf(wanted))}, downloaded once and kept in this browser. It runs on your own machine and no sound leaves it.`));
                const row = make("div", "quire-dictation-row");
                row.append(action("Download and start", () => void download(), "quire-dictation-action primary"), action("Not now", () => setState("off")));
                parts.push(row);
            } else if (state === "downloading") {
                parts.push(line("quire-dictation-plain", "Downloading the speech model."));
                bar = make("div", "quire-dictation-progress");
                bar.setAttribute("role", "progressbar");
                bar.append(make("i"));
                text = make("p", "quire-dictation-count");
                parts.push(bar, text, action("Cancel", () => provider.cancel()));
                updateProgress();
            } else if (state === "loading") {
                parts.push(line("quire-dictation-plain", "Getting the model ready. The first time on a device takes longer."));
            } else if (state === "listening" && recognizer) {
                const speed = session?.speed() ?? 0;
                parts.push(line("quire-dictation-plain", `Listening. Running on ${recognizer.backend}, loaded in ${(loadMs / 1000).toFixed(1)} seconds.${speed > 0 ? ` About ${(1 / speed).toFixed(1)} times faster than speech.` : ""}`));
                if (session?.mode() === "pause") parts.push(line("quire-dictation-warn", "Writing each phrase when you pause, because this machine cannot keep up with live words."));
            }
            if (note && state !== "downloading") parts.push(line("quire-dictation-warn", note));
            if (message) parts.push(line("quire-dictation-warn", message));

            // spoken commands
            const toggleCommands = make("button", "quire-dictation-switch");
            toggleCommands.type = "button";
            toggleCommands.setAttribute("role", "switch");
            toggleCommands.setAttribute("aria-checked", String(commands));
            toggleCommands.append(make("span", "quire-dictation-track"), make("span", "quire-dictation-label", "Spoken punctuation and commands"));
            toggleCommands.addEventListener("click", () => {
                commands = !commands;
                remember(KEPT.commands, commands ? "on" : "off");
                render();
            });
            parts.push(toggleCommands);
            parts.push(line("quire-dictation-hint", commands ? "Say comma, period, question mark, new line, new paragraph, heading, bullet point, undo that, delete that, stop dictation." : "Every word is written down as it is heard."));

            const row = make("div", "quire-dictation-row");
            row.append(
                action("Custom words", () => {
                    view = "words";
                    renderWords();
                }),
            );
            if (cached.get(wanted.id) && state !== "listening" && state !== "downloading" && state !== "loading") {
                row.append(
                    action(`Remove the model (${megabytes(sizeOf(wanted))})`, async () => {
                        recognizer?.dispose();
                        recognizer = undefined;
                        await provider.remove(wanted);
                        await refresh();
                        say(`The ${wanted.name.toLowerCase()} model was removed from this browser.`);
                    }),
                );
            }
            parts.push(row);
            if (used > 0) parts.push(line("quire-dictation-hint", `Models in this browser take ${megabytes(used)}.`));
            parts.push(line("quire-dictation-credit", `${wanted.credit}. Licensed ${wanted.license}. Runs here with ONNX Runtime Web and parakeet.js.`));
            panel.replaceChildren(...parts);
        }

        // ---- the custom words ----
        function renderWords() {
            const parts: HTMLElement[] = [];
            const head = make("div", "quire-dictation-head");
            head.append(make("h2", "quire-dictation-title", "Custom words"), action("Back", () => ((view = "main"), render())));
            parts.push(head);
            parts.push(line("quire-dictation-hint", "Words and names to prefer, and what the recognizer tends to write instead, separated by commas. Shortcuts write out a longer text for a short phrase you say."));
            const keep = () => {
                custom = {
                    words: custom.words.filter((entry) => entry.word.trim()),
                    shortcuts: custom.shortcuts.filter((each) => each.say.trim() && each.write),
                };
                if (!saveWords(custom)) message = "The list could not be kept in this browser.";
            };
            const field = (value: string, placeholder: string, edit: (value: string) => void) => {
                const each = make("input", "quire-link-field quire-dictation-field");
                each.value = value;
                each.placeholder = placeholder;
                each.spellcheck = false;
                each.setAttribute("aria-label", placeholder);
                each.addEventListener("input", () => {
                    edit(each.value);
                    saveWords({ words: custom.words.filter((entry) => entry.word.trim()), shortcuts: custom.shortcuts.filter((s) => s.say.trim() && s.write) });
                });
                each.addEventListener("keydown", (event) => event.stopPropagation());
                return each;
            };
            const remove = (run: () => void) => {
                const each = make("button", "quire-button quire-dictation-remove", "Remove");
                each.type = "button";
                each.setAttribute("aria-label", "Remove this line");
                each.addEventListener("click", () => {
                    run();
                    keep();
                    renderWords();
                });
                return each;
            };
            parts.push(make("h3", "quire-dictation-sub", "Words to prefer"));
            for (const entry of custom.words) {
                const row = make("div", "quire-dictation-line");
                row.append(
                    field(entry.word, "Word", (value) => (entry.word = value)),
                    field(entry.sounds.join(", "), "Sounds like", (value) => (entry.sounds = value.split(",").map((each) => each.trim()).filter(Boolean))),
                    remove(() => (custom.words = custom.words.filter((each) => each !== entry))),
                );
                parts.push(row);
            }
            parts.push(
                action("Add a word", () => {
                    custom.words.push({ word: "", sounds: [] });
                    renderWords();
                }),
            );
            parts.push(make("h3", "quire-dictation-sub", "Shortcuts"));
            for (const entry of custom.shortcuts) {
                const row = make("div", "quire-dictation-line");
                row.append(
                    field(entry.say, "When I say", (value) => (entry.say = value)),
                    field(entry.write, "Write", (value) => (entry.write = value)),
                    remove(() => (custom.shortcuts = custom.shortcuts.filter((each) => each !== entry))),
                );
                parts.push(row);
            }
            parts.push(
                action("Add a shortcut", () => {
                    custom.shortcuts.push({ say: "", write: "" });
                    renderWords();
                }),
            );
            parts.push(line("quire-dictation-hint", "Try it: " + (custom.words[0]?.sounds[0] ? `"${correct(custom.words[0].sounds[0], custom)}" is written for "${custom.words[0].sounds[0]}".` : "add a word and say it.")));
            panel.replaceChildren(...parts);
            if (message) parts.push(line("quire-dictation-warn", message));
        }

        function openPanel(from: HTMLElement) {
            closeOthers();
            box ??= flowMenu("Dictation", { className: "quire-dictation-menu" });
            view = "main";
            render();
            void refresh();
            box.open(from, panel);
        }

        void refresh();

        return {
            button,
            more,
            mount(into) {
                into.append(button, more);
            },
            items(from) {
                return [
                    { label: state === "listening" ? "Stop dictation" : "Start dictation", hint: KEY, icon: microphoneIcon(), run: () => toggle() },
                    { label: "Dictation settings", run: () => openPanel(from) },
                ];
            },
            toggle,
            state: () => state,
            destroy() {
                starting++;
                clearTimeout(release);
                void session?.stop("button");
                mic?.close();
                recognizer?.dispose();
                surface.element.removeEventListener("keydown", onKey, true);
                removeEventListener("scroll", follow, true);
                removeEventListener("resize", follow);
                unselect();
                box?.box.remove();
                live.remove();
                ghost.remove();
                button.remove();
                more.remove();
            },
        };
    }
}
