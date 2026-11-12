// The Spectrum page (src/pages/spectrum.astro) brought to life: it reads the values from `?c=` and
// the language from `?l=`, sets the sliders, puts every word in that language, and from then on
// keeps the chart, the share link and the address in step with the sliders. The address is changed
// in place with history.replaceState, so moving a slider never reloads the page.
//
// The chart's shape flows from one set of values to the next with the site's easing, and jumps for
// anyone who has asked for reduced motion. All the working out is in src/spectrum/.

import { axes, MIDDLE, start, UNSET, type Values } from "../spectrum/axes";
import { decode, encode } from "../spectrum/code";
import { address, breakable, languages, pick, said, words, type Code, type Words } from "../spectrum/languages";
import { between, corners, place, settle, shape, shown } from "../spectrum/radar";

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** How long the chart takes to flow to new values, in milliseconds. */
const FLOW = 520;
/** Keys that move a slider. On an unset slider the first of them only sets it, where it stands. */
const MOVES = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

const root = document.querySelector<HTMLElement>("[data-spectrum]");
if (root) run(root);

function run(root: HTMLElement): void {
    const query = new URLSearchParams(location.search);
    let language: Code = pick(query.get("l"));
    let text: Words = words(language);
    const opened = decode(query.get("c") ?? "");
    const values: Values = opened ?? start();
    // What each slider held before it was unset, so that setting it again puts it back there.
    const before = values.map((value) => value || MIDDLE);
    // The address only gains a code once there is something to carry: a link was opened, or a slider moved.
    let chosen = Boolean(opened);

    const find = <T extends Element>(selector: string, within: ParentNode = root) => within.querySelector<T>(selector)!;
    const rows = axes.map((axis) => find<HTMLLIElement>(`[data-axis="${axis}"]`));
    const sliders = rows.map((row) => find<HTMLInputElement>("input[type=range]", row));
    const unsets = rows.map((row) => find<HTMLButtonElement>(".spectrum-unset", row));
    const link = find<HTMLInputElement>("#spectrum-link");
    const copy = find<HTMLButtonElement>(".spectrum-copy");
    const copied = find<HTMLElement>(".spectrum-copied");
    const figure = find<SVGPathElement>(".spectrum-shape");
    const dots = [...root.querySelectorAll<SVGCircleElement>(".spectrum-dots circle")];
    const empty = find<SVGTextElement>(".spectrum-empty");
    const summary = [...root.querySelectorAll<HTMLLIElement>(".spectrum-summary li")];
    const translator = find<HTMLElement>(".spectrum-translator");
    const pickers = [...root.querySelectorAll<HTMLAnchorElement>("[data-language]")];

    // ---- words ----

    /** A word by its place in `Words`, such as `axes.genderIdentity.label`. */
    const word = (key: string): string => String(key.split(".").reduce<unknown>((within, part) => (within as Record<string, unknown> | undefined)?.[part], text) ?? "");

    /** Whether the language has this word of its own. */
    const owned = (key: string): boolean => key.split(".").reduce<unknown>((within, part) => (within as Record<string, unknown> | undefined)?.[part], languages[language]) !== undefined;

    function speak(): void {
        text = words(language);
        root.lang = language;
        root.dir = text.rtl ? "rtl" : "ltr";
        for (const node of root.querySelectorAll<HTMLElement>("[data-say]")) {
            node.textContent = breakable(word(node.dataset.say!));
            // A word this language lacks is the English one, and is marked so for screen readers.
            if (language !== "en" && !owned(node.dataset.say!)) node.lang = "en";
            else node.removeAttribute("lang");
        }
        axes.forEach((axis, index) => unsets[index]!.setAttribute("aria-label", `${text.unset}: ${text.axes[axis].label}`));
        for (const picker of pickers) {
            const code = picker.dataset.language as Code;
            if (code === language) picker.setAttribute("aria-current", "true");
            else picker.removeAttribute("aria-current");
        }
        translator.hidden = !text.translator;
        translator.replaceChildren();
        if (text.translator) {
            const { said: lead, name, link: home } = text.translator;
            const who = document.createElement(home ? "a" : "span");
            who.textContent = name;
            if (home && who instanceof HTMLAnchorElement) who.href = home;
            translator.append(`${lead} `, who);
        }
        copied.textContent = "";
        copied.classList.remove("shown");
    }

    // ---- values ----

    let writing = 0;
    function show(): void {
        axes.forEach((axis, index) => {
            const value = values[index]!;
            const slider = sliders[index]!;
            if (value !== UNSET) slider.value = String(value);
            else slider.value = String(before[index]);
            slider.setAttribute("aria-valuetext", said(text, axis, value));
            rows[index]!.classList.toggle("unset", value === UNSET);
            unsets[index]!.setAttribute("aria-pressed", String(value === UNSET));
        });
        flow(corners(values));
        const code = encode(values);
        const here = address(chosen ? code : undefined, language);
        link.value = new URL(address(code, language), location.origin).href;
        pickers.forEach((picker) => (picker.href = address(chosen ? code : undefined, picker.dataset.language as Code)));
        // A drag sends many changes; the address is written once they pause, and browsers limit how often it may be.
        clearTimeout(writing);
        writing = window.setTimeout(() => {
            if (location.pathname + location.search !== here) history.replaceState(history.state, "", here);
        }, 120);
    }

    function set(index: number, value: number): void {
        values[index] = value;
        if (value !== UNSET) before[index] = value;
        chosen = true;
        show();
    }

    axes.forEach((_, index) => {
        const slider = sliders[index]!;
        slider.addEventListener("input", () => set(index, Number(slider.value)));
        // Taking hold of an unset slider sets it where it stands; moving it then moves it from there.
        slider.addEventListener("pointerdown", () => values[index] === UNSET && set(index, Number(slider.value)));
        slider.addEventListener("keydown", (event) => {
            if (values[index] !== UNSET || !MOVES.includes(event.key)) return;
            event.preventDefault();
            set(index, before[index]!);
        });
        unsets[index]!.addEventListener("click", () => set(index, values[index] === UNSET ? before[index]! : UNSET));
    });

    // ---- the chart ----

    let drawn = corners(start());
    let moving = 0;

    function draw(now: number[]): void {
        const { d, whole } = shape(now);
        figure.setAttribute("d", d);
        figure.classList.toggle("whole", whole);
        now.forEach((value, index) => {
            const at = place(value, index);
            const dot = dots[index]!;
            dot.setAttribute("cx", at.x.toFixed(1));
            dot.setAttribute("cy", at.y.toFixed(1));
            dot.classList.toggle("gone", value === 0);
        });
        drawn = now;
    }

    function flow(to: number[]): void {
        cancelAnimationFrame(moving);
        to.forEach((value, index) => {
            const group = summary[index]!;
            group.textContent = `${word(`corners.${group.dataset.corner}`)}: ${value === 0 ? text.unset : shown(value)}`;
        });
        empty.classList.toggle("shown", to.every((value) => value === 0));
        if (still.matches) return draw(to);
        const from = drawn;
        const began = performance.now();
        const step = (time: number) => {
            const along = Math.min((time - began) / FLOW, 1);
            draw(between(from, to, settle(along)));
            if (along < 1) moving = requestAnimationFrame(step);
        };
        moving = requestAnimationFrame(step);
    }

    // ---- languages ----

    for (const picker of pickers) {
        picker.addEventListener("click", (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            language = picker.dataset.language as Code;
            speak();
            show();
        });
    }

    // ---- the link ----

    let hiding = 0;
    copy.addEventListener("click", async () => {
        let done = false;
        try {
            await navigator.clipboard.writeText(link.value);
            done = true;
        } catch {
            // Without the clipboard, the link is selected so it can be copied by hand.
            link.select();
        }
        if (!done) return;
        // "Copied" grows out of the button and, a moment later, goes back into it.
        copied.textContent = text.copied;
        copied.classList.remove("shown");
        void copied.offsetWidth;
        copied.classList.add("shown");
        clearTimeout(hiding);
        hiding = window.setTimeout(() => copied.classList.remove("shown"), 1800);
    });
    link.addEventListener("focus", () => link.select());

    speak();
    show();
}
