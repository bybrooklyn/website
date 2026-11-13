// Checking, drawn: a faint underline under each finding (the browser's highlights, as find and
// replace uses them, so the text's own elements are never touched), a popover that grows from the
// word when it is clicked or reached by keyboard, with what is wrong and the fixes, a count at the
// end of the bar that opens the list of everything found, and the settings. Loaded by mount.ts the
// first time checking is used.
//
// Checking runs in idle time, a slice at a time, after a pause in typing; the checker looks again
// only at the blocks that changed. Keys, in the text: F8 and Shift+F8 go to the next finding and
// the one before, Alt+Enter opens the one at the cursor.

import type { Position } from "../document";
import { control, flowMenu, make } from "../ui";
import { createChecker, KINDS, ruleOn, type Context, type Finding, type Fix, type Job, type Rule, type Unit } from "./engine";
import { loadDictionary, type Dictionary } from "./dictionary";
import { byKind, findingAt, findingKey, KIND_NAMES, loadIgnored, loadOwn, loadPrefs, nextFinding, saveIgnored, saveOwn, savePrefs, shownFindings, type Ignored } from "./findings";
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
    const count = control("Checking", make("span", "quire-check-number", "0"), () => (list.isOpen() ? list.close(true) : openList()), "quire-button quire-check-count");
    count.setAttribute("aria-haspopup", "dialog");
    host.bar.querySelector(".quire-bar-end")?.prepend(count);
    const number = count.firstElementChild as HTMLElement;

    const list = flowMenu("Everything found", { align: "right", className: "quire-check-list" });
    const pop = flowMenu("What was found", { className: "quire-check-pop" });
    const settingsMenu = flowMenu("Checking settings", { align: "right", className: "quire-check-settings" });
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
        shown = prefs.on ? shownFindings(findings, ignored, textOf, typingAt()) : [];
        paint();
        number.textContent = String(shown.length);
        count.setAttribute("aria-label", `Checking: ${shown.length === 0 ? "nothing found" : shown.length === 1 ? "one thing found" : `${shown.length} things found`}`);
        count.classList.toggle("shown", prefs.on);
        count.classList.toggle("clear", prefs.on && shown.length === 0);
        count.inert = !prefs.on;
        if (list.isOpen()) list.open(count, listBody());
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
    function action(label: string, act: () => void, className = "quire-check-action") {
        const button = make("button", `quire-button ${className}`, label);
        button.type = "button";
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
            pop.close(false);
            act();
        });
        return button;
    }
    function card(finding: Finding): HTMLElement {
        const body = make("div", "quire-check-card");
        body.setAttribute("role", "dialog");
        const known = rule(finding.rule);
        body.append(make("p", `quire-check-kind ${finding.kind}`, known?.label ?? KIND_NAMES[finding.kind]), make("p", "quire-check-message", finding.message));
        if (known?.why) body.lastElementChild!.setAttribute("title", known.why);
        const fixes = [...finding.fixes, ...(finding.suggest?.() ?? [])];
        if (fixes.length) {
            const row = make("div", "quire-check-fixes");
            for (const fix of fixes) row.append(action(fix.label, () => run(fix, finding), "quire-check-fix"));
            body.append(row);
        } else if (finding.kind === "spelling") body.append(make("p", "quire-check-none", "No suggestions."));
        const more = make("div", "quire-check-more");
        if (finding.word) {
            const word = finding.word;
            more.append(
                action("Add to dictionary", () => {
                    own.add(word);
                    saveOwn(keep, own);
                    checker.forget();
                    soon(0);
                }),
                action("Ignore in this document", () => {
                    ignored = { ...ignored, words: [...ignored.words, word] };
                    saveIgnored(keep, ignoredFor, ignored);
                    checker.forget();
                    refresh();
                    soon(0);
                }),
            );
        } else
            more.append(
                action("Ignore", () => {
                    ignored = { ...ignored, findings: [...ignored.findings, findingKey(finding, textOf(finding))] };
                    saveIgnored(keep, ignoredFor, ignored);
                    refresh();
                }),
            );
        more.append(
            action("Switch this rule off", () => {
                prefs.settings.rules[finding.rule] = false;
                apply();
            }),
        );
        body.append(more);
        return body;
    }
    function openPop(finding: Finding, focusFirst: boolean) {
        const range = surface.rangeOf(finding.range.start, finding.range.end);
        const rects = range?.getClientRects();
        const box = rects?.[0] ?? range?.getBoundingClientRect();
        if (!box) return;
        Object.assign(anchor.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(box.width, 8)}px`, height: `${box.height}px` });
        pop.open(anchor, card(finding), focusFirst);
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
                if (shownFindings(findings, ignored, textOf, typingAt()).length !== shown.length) refresh();
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
            section.append(make("h3", `quire-check-kind ${group.kind}`, `${KIND_NAMES[group.kind]} ${group.findings.length}`));
            for (const finding of group.findings.slice(0, LISTED)) {
                const line = make("button", "quire-check-line");
                line.type = "button";
                const words = textOf(finding).replace(/\s+/g, " ").trim();
                line.append(make("span", "quire-check-words", words.length > 40 ? `${words.slice(0, 38)}…` : words || "(here)"), make("span", "quire-check-said", finding.message));
                line.addEventListener("mousedown", (event) => event.preventDefault());
                line.addEventListener("click", () => {
                    list.close(false);
                    go(finding);
                });
                section.append(line);
            }
            if (group.findings.length > LISTED) section.append(make("p", "quire-check-none", `and ${group.findings.length - LISTED} more`));
            body.append(section);
        }
        const foot = make("div", "quire-check-foot");
        const settings = make("button", "quire-button quire-check-action", "Settings");
        settings.type = "button";
        settings.addEventListener("click", () => openSettings(count, false));
        foot.append(settings, make("span", "quire-check-keys", "F8 next, Shift+F8 back"));
        body.append(foot);
        return body;
    }
    function openList() {
        now();
        list.open(count, listBody(), document.activeElement === count);
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
            group.append(make("legend", "", KIND_NAMES[kind]));
            group.append(box(`All of ${KIND_NAMES[kind].toLowerCase()}`, prefs.settings.kinds[kind], (on) => {
                prefs.settings.kinds[kind] = on;
                apply();
                // the kind's own rules fold in or out under it
                settingsMenu.open(lastFrom ?? count, settingsBody());
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
        body.append(numbers);
        return body;
    }
    let lastFrom: HTMLElement | undefined;
    function openSettings(from: HTMLElement, switchOn: boolean) {
        if (switchOn && !prefs.on) {
            prefs.on = true;
            apply();
        }
        lastFrom = from;
        settingsMenu.open(from, settingsBody(), true);
    }

    apply();
    return {
        openSettings,
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
            surface.element.removeEventListener("beforeinput", onInput);
            surface.element.spellcheck = spellcheckWas;
            for (const menu of [list, pop, settingsMenu]) menu.box.remove();
            anchor.remove();
            count.remove();
        },
    };
}
