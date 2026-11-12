// The Spectrum page (src/pages/spectrum.astro) brought to life: it reads the values from `?c=` and
// the language from `?l=`, sets the sliders, puts every word in that language, and from then on
// keeps the share link and the address in step with the sliders. The address is changed in place
// with history.replaceState, so moving a slider never reloads the page.
//
// Each slider is a real range input, unseen, over a rail and thumb that are drawn. Dragged, the
// thumb follows the pointer with no steps; let go, it glides to the nearest of the seventeen
// positions with the site's easing, and only then do the value and the address change. A click on
// the track glides there; the keys glide one position, four, or to an end. Under reduced motion it
// goes there at once. The working out is in src/spectrum/.

import { axes, MIDDLE, start, UNSET, type Values } from "../spectrum/axes";
import { decode, encode } from "../spectrum/code";
import { address, breakable, languages, pick, said, words, type Code, type Words } from "../spectrum/languages";
import { along, keyed, nearest, pointed, settle } from "../spectrum/slider";
import { still } from "./opening";

/** How long the thumb takes to settle when let go or clicked, and when a key moves it, in milliseconds. */
const GLIDE = 420;
const STEP = 200;
/** How far a finger must move sideways before it is taken as dragging the thumb and not the start of a scroll, in pixels. */
const TOUCH_SLOP = 6;

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
    const tracks = rows.map((row) => find<HTMLElement>(".spectrum-track", row));
    const rails = rows.map((row) => find<HTMLElement>(".spectrum-rail", row));
    const thumbs = rows.map((row) => find<HTMLElement>(".spectrum-thumb", row));
    const unsets = rows.map((row) => find<HTMLButtonElement>(".spectrum-unset", row));
    const link = find<HTMLInputElement>("#spectrum-link");
    const copy = find<HTMLButtonElement>(".spectrum-copy");
    const copied = find<HTMLElement>(".spectrum-copied");
    const status = find<HTMLElement>(".spectrum-status");
    const translator = find<HTMLElement>(".spectrum-translator");
    const pickers = [...root.querySelectorAll<HTMLAnchorElement>("[data-language]")];

    // ---- words ----

    /** A word by its place in `Words`, such as `axes.genderIdentity.label`. */
    const look = (within: unknown, key: string): unknown => key.split(".").reduce<unknown>((inside, part) => (inside as Record<string, unknown> | undefined)?.[part], within);
    const word = (key: string): string => String(look(text, key) ?? "");

    function speak(): void {
        text = words(language);
        root.lang = language;
        root.dir = text.rtl ? "rtl" : "ltr";
        for (const node of root.querySelectorAll<HTMLElement>("[data-say]")) {
            node.textContent = breakable(word(node.dataset.say!));
            // A word this language lacks is the English one, and is marked so for screen readers.
            if (language !== "en" && look(languages[language], node.dataset.say!) === undefined) node.lang = "en";
            else node.removeAttribute("lang");
        }
        axes.forEach((axis, index) => unsets[index]!.setAttribute("aria-label", `${text.unset}: ${text.axes[axis].label}`));
        for (const picker of pickers) {
            if (picker.dataset.language === language) picker.setAttribute("aria-current", "true");
            else picker.removeAttribute("aria-current");
        }
        // The translator's line keeps its last words while it draws shut, so it does not empty first.
        const credit = text.translator;
        translator.classList.toggle("open", Boolean(credit));
        if (credit) {
            const line = translator.firstElementChild!;
            const who = document.createElement(credit.link ? "a" : "span");
            who.textContent = credit.name;
            if (credit.link && who instanceof HTMLAnchorElement) who.href = credit.link;
            line.replaceChildren(`${credit.said} `, who);
        }
        copied.classList.remove("shown");
    }

    // ---- values ----

    let writing = 0;
    /** Where each thumb was left by hand, from 0 to 1 along its track, when that is not exactly on a position. */
    const rest: (number | undefined)[] = axes.map(() => undefined);
    function show(): void {
        axes.forEach((axis, index) => {
            const value = values[index]!;
            sliders[index]!.value = String(value || before[index]);
            sliders[index]!.setAttribute("aria-valuetext", said(text, axis, value));
            rows[index]!.classList.toggle("unset", value === UNSET);
            unsets[index]!.setAttribute("aria-pressed", String(value === UNSET));
            // the thumb stays exactly where it was left; only a link's copy of it is rounded to a position
            if (!moving[index]) put(index, rest[index] ?? along(value || before[index]!));
        });
        const code = encode(values);
        const here = address(chosen ? code : undefined, language);
        link.value = new URL(address(code, language), location.origin).href;
        pickers.forEach((picker) => (picker.href = address(chosen ? code : undefined, picker.dataset.language as Code)));
        // Many changes in a row are written once they pause; browsers limit how often the address may change.
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

    // ---- the thumb ----

    /** Where each thumb is drawn, from 0 at the start of its track to 1 at the end. */
    const places = axes.map(() => along(MIDDLE));
    /** The glide each thumb is in, if any. */
    const moving: (number | undefined)[] = axes.map(() => undefined);
    /** Where each slider is headed by the keys, so that keys pressed quickly add up. */
    const heading: (number | undefined)[] = axes.map(() => undefined);

    function put(index: number, place: number): void {
        places[index] = place;
        thumbs[index]!.style.insetInlineStart = `${place * 100}%`;
    }

    function halt(index: number): void {
        if (moving[index] !== undefined) cancelAnimationFrame(moving[index]!);
        moving[index] = undefined;
    }

    /** Moves a thumb from where it is to a place along its track, with the site's easing, then does `then`. */
    function slide(index: number, to: number, time: number, then: () => void): void {
        halt(index);
        const from = places[index]!;
        const done = () => {
            moving[index] = undefined;
            put(index, to);
            then();
        };
        if (still.matches || time <= 0 || from === to) return done();
        const began = performance.now();
        const step = (now: number) => {
            const progress = Math.min((now - began) / time, 1);
            put(index, from + (to - from) * settle(progress));
            if (progress < 1) moving[index] = requestAnimationFrame(step);
            else done();
        };
        moving[index] = requestAnimationFrame(step);
    }

    /** Glides a thumb to a position, and only once it is there sets the slider to it. */
    const glide = (index: number, value: number, time: number) => {
        rest[index] = undefined;
        slide(index, along(value), time, () => {
            heading[index] = undefined;
            set(index, value);
        });
    };
    /** Leaves a thumb at a place of the visitor's choosing, gliding there if it is not there already. The value kept, and shared, is the nearest position. */
    const leave = (index: number, place: number, time: number) =>
        slide(index, place, time, () => {
            heading[index] = undefined;
            rest[index] = place;
            set(index, nearest(place));
        });

    axes.forEach((_, index) => {
        const slider = sliders[index]!;
        const track = tracks[index]!;
        const thumb = thumbs[index]!;
        const at = (event: PointerEvent) => {
            const box = rails[index]!.getBoundingClientRect();
            return pointed(event.clientX, box.left, box.width, text.rtl);
        };

        // A press on the track: dragging follows the pointer, and letting go settles on the nearest position.
        let hold: { pointer: number; x: number; offset: number; dragging: boolean } | undefined;
        track.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || hold) return;
            const place = at(event);
            const box = thumb.getBoundingClientRect();
            const onThumb = event.clientX >= box.left - 4 && event.clientX <= box.right + 4;
            halt(index);
            heading[index] = undefined;
            // Taken by the thumb, it keeps its place under the pointer; taken by the track, it comes to the pointer.
            hold = { pointer: event.pointerId, x: event.clientX, offset: onThumb ? places[index]! - place : 0, dragging: false };
            track.setPointerCapture(event.pointerId);
            slider.focus({ preventScroll: true });
            // The mouse would otherwise start selecting the words around it.
            if (event.pointerType === "mouse") event.preventDefault();
        });
        track.addEventListener("pointermove", (event) => {
            if (!hold || event.pointerId !== hold.pointer) return;
            const slop = event.pointerType === "mouse" ? 0 : TOUCH_SLOP;
            if (!hold.dragging && Math.abs(event.clientX - hold.x) > slop) {
                hold.dragging = true;
                track.classList.add("held");
            }
            if (hold.dragging) put(index, Math.min(Math.max(at(event) + hold.offset, 0), 1));
        });
        const letGo = (event: PointerEvent) => {
            if (!hold || event.pointerId !== hold.pointer) return;
            const place = hold.dragging ? places[index]! : at(event);
            const hold_dragged = hold.dragging;
            hold = undefined;
            track.classList.remove("held");
            // dragged, it stays where it was let go; clicked on the track, the thumb glides to the click
            leave(index, place, hold_dragged ? 0 : GLIDE);
        };
        track.addEventListener("pointerup", letGo);
        // The browser took the touch for a scroll up or down: the thumb goes back where it was.
        track.addEventListener("pointercancel", (event) => {
            if (!hold || event.pointerId !== hold.pointer) return;
            hold = undefined;
            track.classList.remove("held");
            slide(index, along(values[index] || before[index]!), GLIDE, () => {});
        });

        slider.addEventListener("keydown", (event) => {
            const from = heading[index] ?? (values[index] || before[index]!);
            const to = keyed(from, event.key, text.rtl);
            if (to === undefined) return;
            event.preventDefault();
            // An unset slider is set where it stands by the first key, as taking hold of it does.
            if (values[index] === UNSET && heading[index] === undefined) return glide(index, from, 0);
            heading[index] = to;
            glide(index, to, STEP);
        });
        // Assistive technology sets the value itself, with no key: the thumb follows it there.
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            if (value !== values[index]) glide(index, value, STEP);
        });

        unsets[index]!.addEventListener("click", () => set(index, values[index] === UNSET ? before[index]! : UNSET));
    });

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
        try {
            await navigator.clipboard.writeText(link.value);
        } catch {
            // Without the clipboard, the link is selected so it can be copied by hand.
            link.select();
            return;
        }
        // "Copied" grows out of the button and, a moment later, goes back into it.
        status.textContent = text.copied;
        copied.classList.add("shown");
        clearTimeout(hiding);
        hiding = window.setTimeout(() => {
            copied.classList.remove("shown");
            status.textContent = "";
        }, 1800);
    });
    link.addEventListener("focus", () => link.select());

    speak();
    show();
}
