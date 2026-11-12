// What the controls in src/styles/controls.css need from a script, and nothing more:
//
//   pill switch   places the marker under the chosen word, and moves it only when the choice changes;
//                 the arrow keys are the radio inputs' own
//   slider        keeps the value beside it up to date
//   menu          measures the box it grows into, opens and closes it, and works its keys: Enter, Space or
//                 the down arrow open it, the arrows and Home and End go through it, Escape and Tab close it
//
// and three things a page can call: say() changes a status line's sentence, relabel() changes a button's
// words for a moment without changing its width, and busy() marks a button busy and not.
//
// A page imports it in a <script>; it sets up every control on the page. controls(root) sets up ones
// added later.

const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Puts a pill switch's marker under its chosen word. `move` says whether it travels there or is simply placed. */
function place(choice: HTMLElement, marker: HTMLElement, move: boolean) {
    const chosen = choice.querySelector<HTMLInputElement>("input:checked")?.closest("label");
    if (!chosen) return;
    if (!move) choice.classList.add("still");
    marker.style.setProperty("--at", `${chosen.offsetLeft}px`);
    marker.style.setProperty("--wide", `${chosen.offsetWidth}px`);
    if (!move) {
        // read once so the place is taken with no transition, then let later changes move it
        void marker.offsetWidth;
        choice.classList.remove("still");
    }
}

function choice(box: HTMLElement) {
    const marker = document.createElement("i");
    marker.className = "choice-marker";
    marker.setAttribute("aria-hidden", "true");
    box.prepend(marker);
    place(box, marker, false);
    box.classList.add("ready");
    box.addEventListener("change", () => place(box, marker, true));
    // a change of size or of typeface moves the words, and the marker is put back under them at once
    new ResizeObserver(() => place(box, marker, false)).observe(box);
    void document.fonts.ready.then(() => place(box, marker, false));
}

function slider(input: HTMLInputElement) {
    const output = input.parentElement?.querySelector("output");
    if (!output) return;
    const show = () => (output.value = input.value);
    input.addEventListener("input", show);
    show();
}

/** The menu that is open, if one is: opening another closes it. */
let openMenu: { shut(focus: boolean): void } | undefined;

function menu(holder: HTMLElement) {
    const box = holder.querySelector<HTMLElement>(".menu-box");
    const button = holder.querySelector<HTMLButtonElement>(".menu-button");
    const items = holder.querySelector<HTMLElement>(".menu-items");
    if (!box || !button || !items) return;
    const entries = () => [...items.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute("aria-disabled") !== "true" && !(item as HTMLButtonElement).disabled);
    [...items.children].forEach((item, index) => (item as HTMLElement).style.setProperty("--at", String(index)));
    items.inert = true;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");

    const measure = () => {
        // the box's border, which its size includes and its contents' do not
        const edge = box.offsetWidth - box.clientWidth;
        const shut = button.offsetWidth + edge;
        holder.style.setProperty("--shut", `${shut}px`);
        holder.style.setProperty("--wide", `${Math.max(shut, items.offsetWidth + edge)}px`);
        holder.style.setProperty("--high", `${button.offsetHeight + items.offsetHeight + edge}px`);
    };
    measure();
    holder.classList.add("ready");
    void document.fonts.ready.then(measure);

    const set = (open: boolean, focus: boolean) => {
        if (open && openMenu && openMenu !== handle) openMenu.shut(false);
        measure();
        holder.classList.toggle("open", open);
        button.setAttribute("aria-expanded", String(open));
        items.inert = !open;
        openMenu = open ? handle : openMenu === handle ? undefined : openMenu;
        if (open && focus) entries()[0]?.focus({ preventScroll: true });
        if (!open && focus) button.focus({ preventScroll: true });
    };
    const handle = { shut: (focus: boolean) => set(false, focus) };
    const isOpen = () => holder.classList.contains("open");

    // a press with the pointer opens it without moving the focus into it; by keyboard the first item is focused
    button.addEventListener("click", (event) => set(!isOpen(), event.detail === 0));
    button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        set(true, false);
        const all = entries();
        all[event.key === "ArrowDown" ? 0 : all.length - 1]?.focus({ preventScroll: true });
    });
    items.addEventListener("keydown", (event) => {
        const all = entries();
        const at = all.indexOf(document.activeElement as HTMLElement);
        const to = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
        if (to !== undefined) {
            event.preventDefault();
            all[(to + all.length) % all.length]?.focus({ preventScroll: true });
        } else if (event.key === "Tab") {
            set(false, false);
        }
    });
    // choosing an item does what it does and closes the menu, and the focus goes back to the button
    items.addEventListener("click", (event) => {
        if ((event.target as Element).closest(".menu-items > *")) set(false, items.contains(document.activeElement));
    });
    holder.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) {
            event.preventDefault();
            event.stopPropagation();
            set(false, true);
        }
    });
    // a press anywhere else closes it
    document.addEventListener("pointerdown", (event) => {
        if (isOpen() && !holder.contains(event.target as Node)) set(false, false);
    });
}

const done = new WeakSet<Element>();

/** Sets up every control under `root` that needs a script and has not been set up yet. */
export function controls(root: ParentNode = document) {
    const fresh = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)].filter((element) => !done.has(element) && done.add(element));
    for (const box of fresh<HTMLElement>(".choice")) choice(box);
    for (const input of fresh<HTMLInputElement>(".slider input[type=range]")) slider(input);
    for (const holder of fresh<HTMLElement>(".menu")) menu(holder);
}

/** Gives a status line a new sentence: the old one lifts away and the new one settles in. */
export function say(status: HTMLElement, words: string) {
    if (status.textContent === words) return;
    if (still.matches) {
        status.textContent = words;
        return;
    }
    status.classList.add("changing");
    setTimeout(() => {
        status.textContent = words;
        status.classList.remove("changing");
        status.classList.add("arriving");
        void status.offsetWidth;
        status.classList.remove("arriving");
    }, 120);
}

const labels = new WeakMap<HTMLElement, { words: string; timer: number }>();

/** Changes a button's words for a while, such as "copied", keeping its width so that nothing beside it moves. */
export function relabel(button: HTMLElement, words: string, time = 2500) {
    const before = labels.get(button);
    if (before) clearTimeout(before.timer);
    const own = before?.words ?? button.textContent ?? "";
    // its width as laid out, which a press that is still settling does not shrink
    button.style.minWidth = getComputedStyle(button).width;
    button.textContent = words;
    const timer = window.setTimeout(() => {
        button.textContent = own;
        labels.delete(button);
    }, time);
    labels.set(button, { words: own, timer });
}

/** Marks a button busy, or not: while busy it shows three still dots in its words' place and does not answer the pointer. */
export function busy(button: HTMLElement, on: boolean) {
    if (on) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
}

controls();
