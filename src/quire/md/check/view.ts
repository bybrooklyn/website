// Checking, drawn: a faint underline under each finding (the browser's highlights, as find and
// replace uses them, so the text's own elements are never touched), a small menu that grows from
// the word when it is clicked or reached by keyboard (its fixes, then the ways to leave it be, as
// findingLines makes them), a count at the end of the bar that opens the list of everything found,
// and the settings. Loaded by mount.ts the first time checking is used.
//
// Checking runs in idle time, a slice at a time, after a pause in typing; the checker looks again
// only at the blocks that changed. Keys, in the text: F8 and Shift+F8 go to the next finding and
// the one before, Alt+Enter opens the one at the cursor. A finding's menu opened by a click leaves
// the keyboard in the text; Down or Up goes into the menu, and Escape there gives the caret back.
//
// A right-click on a misspelled word opens the text's own menu (text-menu.ts) with the very lines of
// the word's own menu first, as Docs and the browsers put them; a right-click on any other finding
// opens its menu. Her own dictionary is listed in a dialog,
// Personal dictionary, where a word is removed and the whole list is downloaded or added to as a
// plain text file, one word to a line.

import type { Position } from "../document";
import { openDialog, type Dialog } from "../../core/dialog";
import { control, flowMenu, make, menuLine, type MenuItem } from "../../core/ui";
import { createChecker, KINDS, ruleOn, type Context, type Finding, type Fix, type Job, type Rule, type Unit } from "./engine";
import { loadDictionary, type Dictionary } from "./dictionary";
import { around, byKind, findingAt, findingKey, findingLines, KIND_NAMES, loadIgnored, loadOwn, loadPrefs, nextFinding, sameTogether, saveIgnored, saveOwn, savePrefs, shownFindings, wordsOfText, wordsText, type Ignored } from "./findings";
import type { CheckingHost } from "./mount";
import { readability } from "./prose";
import { RULES } from "./rules";
import { createSpeller } from "./spelling";

/** Most findings of one kind the list draws; the rest are counted. */
const LISTED = 150;
/** The most time, in milliseconds, one slice of checking may hold the page. */
const BUDGET = 8;

type Highlights = Map<string, unknown>;
type Marker = new (...ranges: globalThis.Range[]) => unknown;

/** Builds checking on the editor. */
export function createChecking(host: CheckingHost & { keep: CheckingHost["keep"] }) {
    const { surface, keep } = host;
    let prefs = loadPrefs(keep);
    const own = loadOwn(keep);
    const documentKey = () => {
        const { store, id, name } = host.where();
        return store && id ? `${store.label}:${id}` : `name:${name}`;
    };
    let ignoredFor = documentKey();
    let ignored: Ignored = loadIgnored(keep, ignoredFor);
    let dictionary: Dictionary | undefined;
    let loading: Promise<void> | undefined;
    /** True when the dictionary did not load: spelling is left to the browser's own checker. */
    let unavailable = false;
    const checker = createChecker(RULES);
    let findings: Finding[] = [];
    let shown: Finding[] = [];
    let texts = new Map<string, string>();
    let units: Unit[] = [];
    let checked: unknown;
    const spellcheckWas = surface.element.spellcheck;
    // under ?debug a rule that throws says so in the console; otherwise it is quietly left out
    const debug = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

    // ---- where links lead: asked of the store in the background, and remembered ----
    const answers = new Map<string, boolean | undefined>();
    const exists = (address: string) => {
        const { store, id } = host.where();
        if (!store?.exists || !id) return undefined;
        const key = `${store.label}:${id}\n${address}`;
        if (answers.has(key)) return answers.get(key);
        answers.set(key, undefined);
        store.exists(id, address).then(
            (there) => {
                answers.set(key, there);
                if (there === false) soon(0);
            },
            () => {},
        );
        return undefined;
    };

    const context = (): Context => ({
        settings: prefs.settings,
        speller: dictionary && prefs.settings.kinds.spelling ? createSpeller(dictionary, prefs.settings.dialect, own, new Set(ignored.words)) : undefined,
        exists: host.where().store?.exists ? exists : undefined,
        document: host.where().id,
        failed: debug ? (id, error) => console.warn(`Checking: the rule ${id} failed and reported nothing.`, error) : undefined,
    });

    // ---- the count, at the end of the bar ----
    const count = control("Checking", make("span", "quire-check-number", "0"), () => (list.isOpen() ? list.close(true) : openList(count)), "quire-button quire-check-count");
    count.setAttribute("aria-haspopup", "menu");
    host.bar.querySelector(".quire-bar-end")?.prepend(count);
    // the count grows in and out: once it has, the bar folds its tools to the room left
    count.addEventListener("transitionend", (event) => event.propertyName === "max-width" && host.relayout?.());
    const number = count.firstElementChild as HTMLElement;

    const list = flowMenu("Everything found", { align: "right", className: "quire-check-list" });
    const pop = flowMenu("What was found", { className: "quire-check-pop" });
    // the settings are a form of many boxes, so a dialog; the list of what was found is a list to pick from, so a menu
    let settingsDialog: Dialog | undefined;
    /** What the list grows from: the count, or Tools when it was asked for there. */
    let listFrom: HTMLElement = count;
    // the popover grows from the word: this stands where the word is, for it to grow from
    const anchor = make("span", "quire-check-anchor");
    anchor.tabIndex = -1;
    anchor.addEventListener("focus", () => surface.focus());
    document.body.append(anchor);

    // ---- checking, in idle time ----
    let job: Job | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    // a slice of checking never takes more than BUDGET, however long the browser says it is idle, so a key pressed meanwhile waits no longer than that
    const idle = (run: (left: () => number) => void) => {
        const slice = (more: () => number) => {
            const end = performance.now() + BUDGET;
            run(() => Math.min(more(), end - performance.now()));
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback((deadline) => slice(() => deadline.timeRemaining()), { timeout: 400 });
        else setTimeout(() => slice(() => Infinity), 16);
    };
    const step = (left: () => number) => {
        waiting = false;
        if (!job) return;
        const done = job.run(left);
        if (!done) return queue();
        job = undefined;
        findings = done;
        units = checker.units();
        texts = new Map(units.map((unit) => [unit.path.join(), unit.read.text]));
        refresh();
    };
    const queue = () => {
        if (waiting) return;
        waiting = true;
        idle(step);
    };
    /** Checks again after `delay` milliseconds (a pause in typing), unless asked again before then. */
    function soon(delay = 250) {
        if (!prefs.on) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (documentKey() !== ignoredFor) {
                ignoredFor = documentKey();
                ignored = loadIgnored(keep, ignoredFor);
                // what was asked of the last document's store is not kept, so the answers do not pile up for every document opened
                answers.clear();
                checker.forget();
            }
            checked = surface.getDocument();
            job = checker.start(surface.getDocument(), context());
            queue();
        }, delay);
    }
    /** Brings the findings up to date with the document now, at once, for a fix or a jump. */
    function now() {
        if (checked === surface.getDocument() && !job) return;
        clearTimeout(timer);
        checked = surface.getDocument();
        const running = checker.start(surface.getDocument(), context());
        let done: Finding[] | undefined;
        while (!(done = running.run(() => Infinity)));
        job = undefined;
        findings = done;
        units = checker.units();
        texts = new Map(units.map((unit) => [unit.path.join(), unit.read.text]));
        refresh();
    }

    const textOf = (finding: Finding) => (texts.get(finding.range.start.path.join()) ?? "").slice(finding.range.start.offset, finding.range.end.offset);
    /** What a finding covers with a little either side, the key it is ignored by. */
    const keyOf = (finding: Finding) => around(texts.get(finding.range.start.path.join()) ?? "", finding.range.start.offset, finding.range.end.offset);
    // where the cursor was left by the last key typed: a word there is still being written
    let typed: Position | undefined;
    let typing = false;
    const onInput = () => (typing = true);
    /** The cursor, while it has not moved from where the last key typed left it. */
    const typingAt = (): Position | undefined => {
        const { anchor: from, focus } = surface.getSelection();
        if (!typed || from.offset !== focus.offset || from.path.join() !== focus.path.join() || focus.offset !== typed.offset || focus.path.join() !== typed.path.join()) return (typed = undefined);
        return typed;
    };

    // ---- the underlines ----
    const marks = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Highlights }).highlights : undefined;
    const Marker = (globalThis as unknown as { Highlight?: Marker }).Highlight;
    function paint() {
        if (!marks || !Marker) return;
        for (const kind of KINDS) {
            const ranges = prefs.on ? shown.filter((one) => one.kind === kind).map((one) => surface.rangeOf(one.range.start, one.range.end)).filter((range): range is globalThis.Range => !!range && !range.collapsed) : [];
            if (ranges.length) marks.set(`quire-check-${kind}`, new Marker(...ranges));
            else marks.delete(`quire-check-${kind}`);
        }
    }
    function refresh() {
        shown = prefs.on ? shownFindings(findings, ignored, keyOf, typingAt()) : [];
        paint();
        // a number of more or fewer digits makes the count wider or narrower, and the bar is laid out again a frame later
        const digits = number.textContent?.length;
        number.textContent = String(shown.length);
        if (digits !== number.textContent.length || count.classList.contains("shown") !== prefs.on) requestAnimationFrame(() => host.relayout?.());
        count.setAttribute("aria-label", `Checking: ${shown.length === 0 ? "nothing found" : shown.length === 1 ? "one thing found" : `${shown.length} things found`}`);
        count.classList.toggle("shown", prefs.on);
        count.classList.toggle("clear", prefs.on && shown.length === 0);
        count.inert = !prefs.on;
        if (list.isOpen()) list.open(listFrom.isConnected ? listFrom : count, listBody());
    }

    // ---- switching on and off ----
    function apply() {
        savePrefs(keep, prefs);
        const spelling = prefs.on && prefs.settings.kinds.spelling;
        // the browser's own spelling marks would sit on top of these; with no dictionary, the browser's are all there is
        surface.element.spellcheck = spelling && !unavailable ? false : unavailable || spellcheckWas;
        if (spelling && !dictionary && !loading) {
            // switching spelling on again after a failure tries again
            unavailable = false;
            surface.element.spellcheck = false;
            loading = loadDictionary(host.dictionary ?? "/quire/words-en.dat").then(
                (loaded) => {
                    dictionary = loaded;
                    checker.forget();
                    soon(0);
                },
                () => {
                    loading = undefined;
                    unavailable = true;
                    if (prefs.on && prefs.settings.kinds.spelling) surface.element.spellcheck = true;
                    refresh();
                },
            );
        }
        checker.forget();
        if (prefs.on) soon(0);
        else {
            job = undefined;
            findings = [];
            refresh();
        }
    }

    // ---- the popover ----
    const rule = (id: string) => RULES.find((one) => one.id === id);
    function run(fix: Fix, finding: Finding) {
        surface.run((doc) => fix.edit(doc, finding.range));
        surface.focus();
    }
    /** Adds a word to her dictionary: never marked again, in any document. */
    function addWord(word: string) {
        own.add(word);
        saveOwn(keep, own);
        checker.forget();
        soon(0);
    }
    /** Ignores a word in this document only. */
    function ignoreWord(word: string) {
        ignored = { ...ignored, words: [...ignored.words, word] };
        saveIgnored(keep, ignoredFor, ignored);
        checker.forget();
        refresh();
        soon(0);
    }
    /** A finding's menu, the same lines a misspelling puts at the top of the text's menu (findingLines). */
    const linesOf = (finding: Finding) =>
        findingLines(finding, rule(finding.rule)?.label ?? KIND_NAMES[finding.kind], {
            fix: (fix) => run(fix, finding),
            add: addWord,
            ignoreWord,
            ignore: () => {
                ignored = { ...ignored, findings: [...ignored.findings, findingKey(finding, keyOf(finding))] };
                saveIgnored(keep, ignoredFor, ignored);
                refresh();
                surface.focus();
            },
        });
    function openPop(finding: Finding, focusFirst: boolean) {
        const range = surface.rangeOf(finding.range.start, finding.range.end);
        const rects = range?.getClientRects();
        const box = rects?.[0] ?? range?.getBoundingClientRect();
        if (!box) return;
        Object.assign(anchor.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(box.width, 8)}px`, height: `${box.height}px` });
        pop.open(anchor, linesOf(finding), focusFirst);
    }
    /** Selects a finding, brings it into sight and opens its popover. */
    function go(finding: Finding, focusFirst = true) {
        surface.setSelection({ anchor: finding.range.start, focus: finding.range.end });
        surface.focus();
        const box = surface.rangeOf(finding.range.start, finding.range.end)?.getBoundingClientRect();
        const top = host.bar.getBoundingClientRect().bottom + 24;
        if (box && (box.top < top || box.bottom > innerHeight - 80)) scrollBy({ top: box.top - (top + innerHeight) / 2, behavior: "instant" });
        requestAnimationFrame(() => openPop(finding, focusFirst));
    }

    // a click on a finding opens it; one that covers a whole sentence or paragraph opens from the list and the keys only
    const onClick = () => setTimeout(clicked, 40);
    // a moment after the click, when the browser has told the surface where the cursor went
    const clicked = () => {
        if (!prefs.on) return;
        const { anchor: from, focus } = surface.getSelection();
        if (from.offset !== focus.offset || from.path.join() !== focus.path.join()) return;
        const found = findingAt(shown, focus);
        if (found && found.range.end.offset - found.range.start.offset <= 60) openPop(found, false);
    };
    /** The finding under a point on screen, of those short enough to be pressed. */
    const findingUnder = (x: number, y: number, kinds?: Finding["kind"][]) => {
        const inside = (box: DOMRect) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
        return shown.find((one) => (!kinds || kinds.includes(one.kind)) && one.range.end.offset - one.range.start.offset <= 60 && [...(surface.rangeOf(one.range.start, one.range.end)?.getClientRects() ?? [])].some(inside));
    };
    // a right click on an underline other than a misspelling opens its popover; a misspelling's spellings come first in the text's own menu (linesAt)
    const onMenu = (event: MouseEvent) => {
        if (!prefs.on || event.shiftKey) return;
        const found = findingUnder(event.clientX, event.clientY);
        if (!found || found.kind === "spelling") return;
        event.preventDefault();
        openPop(found, true);
    };
    /**
     * The lines a misspelled word puts at the top of the text's menu, the very lines its own menu has
     * (findingLines), ending in their rule. At a point pressed, or at the caret for the menu key. None
     * anywhere else.
     */
    function linesAt(at?: { x: number; y: number }): MenuItem[] {
        if (!prefs.on) return [];
        const found = at ? findingUnder(at.x, at.y, ["spelling"]) : findingAt(shown.filter((one) => one.kind === "spelling"), surface.getSelection().focus);
        return found?.word ? linesOf(found) : [];
    }
    // a finding's menu opened by a click leaves the keyboard in the text, so that typing goes on there; Down or Up goes into the menu
    const onArrow = (event: KeyboardEvent) => {
        if (!pop.isOpen() || (event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const lines = [...pop.box.querySelectorAll<HTMLElement>(".quire-menu-items button:not(:disabled)")];
        const line = event.key === "ArrowDown" ? lines[0] : lines[lines.length - 1];
        if (!line) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        line.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
        if (!prefs.on) return;
        if (event.key === "F8" && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            now();
            const next = nextFinding(shown, event.shiftKey ? surface.getSelection().anchor : surface.getSelection().focus, event.shiftKey ? -1 : 1);
            if (next) go(next);
        } else if (event.key === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey) {
            const found = findingAt(shown, surface.getSelection().focus);
            if (!found) return;
            event.preventDefault();
            openPop(found, true);
        }
    };
    surface.element.addEventListener("click", onClick);
    surface.element.addEventListener("keydown", onKey);
    surface.element.addEventListener("keydown", onArrow, true);
    surface.element.addEventListener("contextmenu", onMenu);
    surface.element.addEventListener("beforeinput", onInput);
    const stops = [
        surface.on("change", () => {
            // a check under way is of the text as it was: it is given up, and what it found in each block so far is kept
            job = undefined;
            if (pop.isOpen()) pop.close(false);
            typed = typing ? surface.getSelection().focus : undefined;
            typing = false;
            soon();
        }),
        // moving off a word just typed shows its underline, drawn in idle time so that keys never wait for it
        surface.on("select", () => {
            if (!prefs.on || !typed) return;
            idle(() => {
                if (shownFindings(findings, ignored, keyOf, typingAt()).length !== shown.length) refresh();
            });
        }),
    ];

    // ---- the list ----
    function listBody(): HTMLElement {
        const body = make("div", "quire-check-all");
        const score = readability(units);
        const head = make("div", "quire-check-head");
        head.append(make("p", "quire-check-title", shown.length ? `${shown.length} ${shown.length === 1 ? "thing" : "things"} to look at` : "Nothing to look at"));
        if (score.words) head.append(make("p", "quire-check-score", `Reading ease ${score.ease}, ${score.sentence} words a sentence`));
        if (unavailable && prefs.settings.kinds.spelling) head.append(make("p", "quire-check-score quire-check-unavailable", "Spelling is unavailable: the dictionary did not load, so the browser's own spelling is on."));
        body.append(head);
        for (const group of byKind(shown)) {
            const section = make("section", "quire-check-group");
            section.append(make("h3", `quire-menu-note quire-check-kind ${group.kind}`, `${KIND_NAMES[group.kind]} ${group.findings.length}`));
            // the same words found again by the same rule are one line, saying how many times
            const lines = sameTogether(group.findings, textOf);
            for (const same of lines.slice(0, LISTED)) {
                const finding = same[0]!;
                const line = make("button", "quire-menu-line quire-check-line");
                line.type = "button";
                const words = textOf(finding).replace(/\s+/g, " ").trim();
                const shownWords = make("span", "quire-check-words", words.length > 40 ? `${words.slice(0, 38)}…` : words || "(here)");
                if (same.length > 1) shownWords.append(make("span", "quire-check-times", `${same.length} times`));
                line.append(shownWords);
                // under a misspelled word nothing more need be said; under anything else, what it is, in its rule's few words
                if (!finding.word) line.append(make("span", "quire-check-said", rule(finding.rule)?.label ?? ""));
                line.addEventListener("mousedown", (event) => event.preventDefault());
                line.addEventListener("click", () => {
                    list.close(false);
                    // the first of them after the cursor, so that pressing the line again goes on to the next
                    go(nextFinding(same, surface.getSelection().focus, 1) ?? finding);
                });
                section.append(line);
            }
            if (lines.length > LISTED) section.append(make("p", "quire-menu-note", `and ${lines.length - LISTED} more`));
            body.append(section);
        }
        // at the foot, after a rule as in any menu, the settings' line and the keys that go through what was found
        const settings = menuLine({ label: "Settings", icon: "settings", run: () => {} });
        settings.classList.add("quire-check-settings-line");
        settings.addEventListener("mousedown", (event) => event.preventDefault());
        settings.addEventListener("click", () => openSettings(settings, false));
        body.append(make("hr", "quire-menu-rule"), settings, make("p", "quire-menu-note quire-check-keys", "F8 next, Shift+F8 back"));
        return body;
    }
    function openList(from: HTMLElement, focusFirst = document.activeElement === from) {
        now();
        listFrom = from;
        list.open(from, listBody(), focusFirst);
    }

    // ---- the settings ----
    function box(label: string, on: boolean, change: (on: boolean) => void, title = "") {
        const line = make("label", "quire-check-switch");
        const input = make("input");
        input.type = "checkbox";
        input.checked = on;
        input.addEventListener("change", () => change(input.checked));
        line.append(input, make("span", "", label));
        if (title) line.title = title;
        return line;
    }
    function settingsBody(): HTMLElement {
        const body = make("div", "quire-check-form");
        body.append(box("Check this document", prefs.on, (on) => {
            prefs.on = on;
            apply();
        }));
        for (const kind of KINDS) {
            const group = make("fieldset", "quire-check-set");
            group.dataset.kind = kind;
            group.append(make("legend", "", KIND_NAMES[kind]));
            group.append(box(`All of ${KIND_NAMES[kind].toLowerCase()}`, prefs.settings.kinds[kind], (on) => {
                prefs.settings.kinds[kind] = on;
                apply();
                // the kind's own rules fold in or out under it, the dialog easing to its new size
                const dialog = settingsDialog;
                if (dialog) dialog.change(() => {
                    dialog.body.replaceChildren(settingsBody());
                    dialog.body.querySelector<HTMLElement>(`[data-kind="${kind}"] input`)?.focus();
                });
            }));
            if (prefs.settings.kinds[kind]) for (const each of RULES.filter((one) => one.kind === kind)) group.append(box(each.label, ruleOn(each, prefs.settings), (on) => {
                prefs.settings.rules[each.id] = on;
                apply();
            }, each.why));
            body.append(group);
        }
        const numbers = make("fieldset", "quire-check-set");
        numbers.append(make("legend", "", "Lengths and spelling"));
        const field = (label: string, key: "sentence" | "paragraph") => {
            const line = make("label", "quire-check-number-line");
            const input = make("input");
            input.type = "number";
            input.min = "5";
            input.max = "1000";
            input.value = String(prefs.settings[key]);
            input.addEventListener("change", () => {
                const value = Math.round(Number(input.value));
                if (value >= 5 && value <= 1000) {
                    prefs.settings[key] = value;
                    apply();
                }
            });
            line.append(make("span", "", label), input);
            return line;
        };
        numbers.append(field("Words in a long sentence", "sentence"), field("Words in a long paragraph", "paragraph"));
        const dialect = make("label", "quire-check-number-line");
        const choose = make("select");
        for (const [value, label] of [["us", "American"], ["gb", "British"]]) {
            const option = make("option", "", label);
            option.value = value!;
            choose.append(option);
        }
        choose.value = prefs.settings.dialect;
        choose.addEventListener("change", () => {
            prefs.settings.dialect = choose.value === "gb" ? "gb" : "us";
            apply();
        });
        dialect.append(make("span", "", "Spelling"), choose);
        numbers.append(dialect);
        const words = make("button", "quire-button quire-check-action quire-check-own", "Personal dictionary");
        words.type = "button";
        words.addEventListener("click", () => openDictionary(words));
        numbers.append(words);
        body.append(numbers);
        return body;
    }
    function openSettings(from: HTMLElement, switchOn: boolean) {
        if (switchOn && !prefs.on) {
            prefs.on = true;
            apply();
        }
        // what is ticked takes effect at once, so the dialog has only Done
        settingsDialog = openDialog(from, {
            title: "Checking settings",
            className: "quire-check-settings",
            body: [settingsBody()],
            returnTo: listFrom.isConnected ? listFrom : count,
            action: { label: "Done", press: (_, dialog) => void dialog.close() },
            onClose: () => (settingsDialog = undefined),
        });
    }

    // ---- her own dictionary ----
    let dictionaryDialog: Dialog | undefined;
    /** The words, each with Remove, or a line saying there are none yet. */
    function dictionaryList(): HTMLElement {
        const words = [...own].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        if (!words.length) return make("p", "quire-own-none", "No words yet. Right-click a word marked as misspelled and choose Add to dictionary.");
        const list = make("ul", "quire-own-list");
        list.setAttribute("aria-label", "Your words");
        for (const word of words) {
            const line = make("li", "quire-own-word");
            const remove = make("button", "quire-button quire-own-remove", "Remove");
            remove.type = "button";
            remove.setAttribute("aria-label", `Remove ${word}`);
            remove.addEventListener("click", () => {
                const near = (line.nextElementSibling ?? line.previousElementSibling)?.querySelector<HTMLElement>(".quire-own-remove")?.getAttribute("aria-label");
                own.delete(word);
                saveOwn(keep, own);
                checker.forget();
                soon(0);
                if (dictionaryDialog) dictionaryDialog.change(() => showWords());
                // the keyboard goes on to the word that took its place
                const buttons = [...(dictionaryDialog?.body.querySelectorAll<HTMLElement>("button") ?? [])];
                (buttons.find((button) => button.getAttribute("aria-label") === near) ?? buttons[0] ?? dictionaryDialog?.actions.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
            });
            line.append(make("span", "quire-own-text", word), remove);
            list.append(line);
        }
        return list;
    }
    /** Draws the list again, and says how many words there are, or what an import did. */
    function showWords(said?: string) {
        const dialog = dictionaryDialog;
        if (!dialog) return;
        const holder = dialog.body.querySelector(".quire-own-holder");
        const count = dialog.body.querySelector(".quire-own-count");
        if (count) count.textContent = said ?? (own.size === 0 ? "" : own.size === 1 ? "One word." : `${own.size.toLocaleString("en")} words.`);
        holder?.replaceChildren(dictionaryList());
    }
    /** Personal dictionary: her words listed, each with Remove, and the list downloaded or added to as a plain text file. */
    function openDictionary(from: HTMLElement) {
        const intro = make("p", "quire-own-intro", "Words here are never marked as misspelled, in any document. They are kept in this browser.");
        const count = make("p", "quire-own-count");
        count.setAttribute("role", "status");
        const holder = make("div", "quire-own-holder");
        const chooser = make("input", "quire-file");
        chooser.type = "file";
        chooser.accept = ".txt,text/plain";
        chooser.tabIndex = -1;
        chooser.setAttribute("aria-hidden", "true");
        chooser.addEventListener("change", async () => {
            const file = chooser.files?.[0];
            chooser.value = "";
            if (!file) return;
            // a file far larger than any list of words is not read
            if (file.size > 2_000_000) return showWords("That file is too large to be a list of words.");
            const before = own.size;
            for (const word of wordsOfText(await file.text())) own.add(word);
            saveOwn(keep, own);
            checker.forget();
            soon(0);
            const added = own.size - before;
            dictionaryDialog?.change(() => showWords(added === 0 ? "No new words in that file." : added === 1 ? "One word added." : `${added.toLocaleString("en")} words added.`));
        });
        dictionaryDialog = openDialog(from, {
            title: "Personal dictionary",
            className: "quire-own-dialog",
            body: [intro, count, holder, chooser],
            returnTo: from.isConnected ? from : undefined,
            action: { label: "Done", press: (_, dialog) => void dialog.close() },
            others: [
                {
                    label: "Download as text",
                    press: () => {
                        const link = make("a");
                        link.href = URL.createObjectURL(new Blob([wordsText(own)], { type: "text/plain" }));
                        link.download = "dictionary.txt";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                    },
                },
                { label: "Add from a text file", press: () => chooser.click() },
            ],
            onClose: () => (dictionaryDialog = undefined),
        });
        showWords();
    }

    /** Spelling and grammar, from Tools: what was found, switching checking on the first time. */
    function openResults(from: HTMLElement) {
        if (!prefs.on) {
            prefs.on = true;
            apply();
        }
        openList(from, true);
    }

    apply();
    return {
        openSettings,
        openResults,
        openDictionary,
        linesAt,
        /** The findings shown now, for tests. */
        findings: () => shown,
        destroy() {
            clearTimeout(timer);
            job = undefined;
            prefs = { ...prefs, on: false };
            paint();
            for (const stop of stops) stop();
            surface.element.removeEventListener("click", onClick);
            surface.element.removeEventListener("keydown", onKey);
            surface.element.removeEventListener("keydown", onArrow, true);
            surface.element.removeEventListener("contextmenu", onMenu);
            surface.element.removeEventListener("beforeinput", onInput);
            surface.element.spellcheck = spellcheckWas;
            for (const menu of [list, pop]) menu.box.remove();
            void settingsDialog?.close();
            void dictionaryDialog?.close();
            anchor.remove();
            count.remove();
        },
    };
}
