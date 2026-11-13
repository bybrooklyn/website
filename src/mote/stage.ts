// The part of Mote every mini shares: a canvas that fits its box and stays
// sharp, a loop that moves in fixed steps, the pointer and a few keys, and
// the page's own colors.
//
//   const stop = mote(element, (m) => {
//       // set the scene up here, with m.width and m.height
//       return {
//           step(dt) {},   // move things on by dt seconds (always 1/120)
//           draw() {},     // draw with m.ctx
//       };
//   });
//
// It also keeps small things between visits (`m.keep`, `m.recall`), reads and
// sets the page's address (`m.link`), and with `?debug` in the address shows
// how long a step takes.
//
// A mini only runs while it can be seen, stops when the scene says it has
// come to rest, and for someone who has asked for reduced motion does not
// start moving until they touch it.

export interface Pointer {
    x: number;
    y: number;
    /** Held down. */
    down: boolean;
    /** Over the canvas. */
    inside: boolean;
}

export type Key = "left" | "right" | "up" | "down" | "action";

export interface Mote {
    readonly canvas: HTMLCanvasElement;
    readonly ctx: CanvasRenderingContext2D;
    /** The size of the drawing area in CSS pixels. */
    width: number;
    height: number;
    /** Seconds stepped so far. */
    time: number;
    /** Shown small in a list, not to be played: no pointer, no keys. A scene can use this to leave out its words and move by itself. */
    readonly preview: boolean;
    pointer: Pointer;
    /** One of the page's colors, such as "--accent", as a value a canvas accepts. */
    color(property: string): string;
    /** Start the loop again after the scene came to rest. For someone who asked for reduced motion, only once they have touched the mini. */
    wake(): void;
    /** A place under the canvas for ordinary buttons and text, for a mini that needs them. Made the first time it is asked for. */
    panel(): HTMLElement;
    /**
     * Something small kept in the browser between visits: a best score, settings, a history. `recall`
     * gives `otherwise` when nothing is kept, or when what is kept was written by another `version`
     * of the mini, so a change to what is kept cannot break it.
     */
    recall<T>(name: string, otherwise: T, version?: number): T;
    keep(name: string, value: unknown, version?: number): void;
    /** What the page's address says after `?`, to read and to set: a mini's state that can be sent to someone as a link. */
    link: { get(name: string): string | null; set(name: string, value: string | null): string };
    /** The page's address ends in `?debug`: the stage shows how long a step takes, and a scene can draw more. */
    readonly debug: boolean;
}

export interface Scene {
    step?(dt: number): void;
    draw(): void;
    /** The canvas changed size. */
    resize?(): void;
    press?(x: number, y: number): void;
    /** Pressed twice quickly in one place. `press` has already been called for each. */
    double?(x: number, y: number): void;
    move?(x: number, y: number): void;
    release?(x: number, y: number): void;
    /** A key went down. */
    keydown?(name: Key): void;
    /** True when nothing is moving, so the loop can stop until something wakes it. */
    resting?(): boolean;
    /** Lines to show with `?debug` in the address, such as how many bodies are awake. It may also draw on `m.ctx`. */
    debug?(): string[];
}

/** Makes an element, for a mini's panel: its tag, what to set on it, and what goes inside. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, set: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...inside: (Node | string)[]): HTMLElementTagNameMap[K] {
    const made = document.createElement(tag);
    const { class: name, ...rest } = set;
    if (name) made.className = name;
    Object.assign(made, rest);
    made.append(...inside);
    return made;
}

/** `value` moved toward `goal` at a rate that covers 0 to 1 in `seconds`. For a move that takes a set time. */
export const toward = (value: number, goal: number, dt: number, seconds: number): number => (value < goal ? Math.min(goal, value + dt / seconds) : Math.max(goal, value - dt / seconds));
/** 0 to 1 made to set off and arrive gently. */
export const gently = (t: number): number => t * t * (3 - 2 * t);

/** The loop moves in steps of this many seconds, whatever the screen's refresh rate. */
export const TICK = 1 / 120;
/** The most time a frame makes up, in seconds: after a pause the loop goes on from where it was and does not race to catch up. */
const BEHIND = 0.05;
/** A frame's time comes with a little jitter. Owed this little short of a whole step, the step is taken now and not a frame late. */
const JITTER = 0.0004;

/**
 * How many steps a frame takes, from the seconds still owed from frames before and the seconds since
 * the last frame, and what is owed after them. On a 60 Hz screen every frame takes two steps, and not
 * now one and now three; on one at 240 Hz, one step every other frame.
 */
export function paced(owed: number, seconds: number): { steps: number; owed: number } {
    // a clock that went backward, or a time that is not a number, gives no steps and is not carried on
    let left = Math.min((Number.isFinite(owed) ? owed : 0) + (seconds > 0 ? seconds : 0), BEHIND);
    let steps = 0;
    while (left >= TICK - JITTER) {
        steps++;
        left -= TICK;
    }
    return { steps, owed: left };
}

/** The arrows, Space and Enter by what they say; the letters by where they are, so that WASD is the same four keys on any keyboard. */
const KEYS: Record<string, Key> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    KeyA: "left",
    KeyD: "right",
    KeyW: "up",
    KeyS: "down",
    " ": "action",
    Enter: "action",
};
const named = (event: KeyboardEvent): Key | undefined => KEYS[event.key] ?? KEYS[event.code];

/** Puts a mini in `host` and returns a function that takes it away again. */
export function mote(host: HTMLElement, make: (m: Mote) => Scene, { label = "An interactive demo.", preview = false } = {}): () => void {
    const canvas = document.createElement("canvas");
    if (!preview) canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    host.append(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => canvas.remove();

    const held = new Set<Key>();
    const colors = new Map<string, string>();
    let frame = 0;
    let last = 0;
    let owed = 0;
    let visible = false;
    let allowed = !matchMedia("(prefers-reduced-motion: reduce)").matches;

    const m: Mote = {
        canvas,
        ctx,
        width: 0,
        height: 0,
        time: 0,
        preview,
        pointer: { x: 0, y: 0, down: false, inside: false },
        color(property) {
            // Looking a color up means restyling the element, so each is looked up once.
            let found = colors.get(property);
            if (!found) {
                host.style.color = `var(${property})`;
                found = getComputedStyle(host).color;
                host.style.color = "";
                colors.set(property, found);
            }
            return found;
        },
        wake: () => void (allowed && start()),
        panel() {
            let panel = host.querySelector<HTMLElement>(".mote-panel");
            if (!panel) {
                panel = document.createElement("div");
                panel.className = "mote-panel";
                host.append(panel);
            }
            return panel;
        },
        recall(name, otherwise, version = 1) {
            try {
                const kept = JSON.parse(localStorage.getItem(`mote:${name}`) ?? "null") as { version: number; value: never } | null;
                return kept?.version === version ? kept.value : otherwise;
            } catch {
                return otherwise;
            }
        },
        keep(name, value, version = 1) {
            try {
                localStorage.setItem(`mote:${name}`, JSON.stringify({ version, value }));
            } catch {
                // Not kept: private browsing, or storage is off.
            }
        },
        link: {
            // One shown small in a list has no say over the page's address.
            get: (name) => (preview ? null : new URLSearchParams(location.search).get(name)),
            set(name, value) {
                const address = new URL(location.href);
                if (value === null) address.searchParams.delete(name);
                else address.searchParams.set(name, value);
                if (!preview) history.replaceState(history.state, "", address);
                return address.href;
            },
        },
        debug: !preview && new URLSearchParams(location.search).has("debug"),
    };

    const fit = () => {
        const scale = window.devicePixelRatio || 1;
        m.width = canvas.clientWidth;
        m.height = canvas.clientHeight;
        // Setting a canvas's size clears it and makes it again, even to the size it is: only a change is set.
        const [wide, high] = [Math.round(m.width * scale), Math.round(m.height * scale)];
        if (canvas.width !== wide) canvas.width = wide;
        if (canvas.height !== high) canvas.height = high;
    };
    fit();
    const scene = make(m);

    /** How long a step has been taking, in milliseconds, evened out over the last few. */
    let took = 0;
    const draw = () => {
        const scale = window.devicePixelRatio || 1;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, m.width, m.height);
        scene.draw();
        if (!m.debug) return;
        const lines = [`step ${took.toFixed(2)} ms of ${(TICK * 1000).toFixed(1)}`, ...(scene.debug?.() ?? [])];
        ctx.font = "12px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        lines.forEach((line, row) => {
            ctx.fillStyle = "#000a";
            ctx.fillRect(6, 6 + row * 16, ctx.measureText(line).width + 8, 16);
            ctx.fillStyle = "#fff";
            ctx.fillText(line, 10, 8 + row * 16);
        });
    };

    const stop = () => {
        cancelAnimationFrame(frame);
        frame = 0;
    };

    function start(): void {
        if (frame || !visible || document.hidden) return;
        last = performance.now();
        owed = 0;
        const loop = (now: number) => {
            // Catch up in fixed steps, but never try to make up a long pause.
            const due = paced(owed, (now - last) / 1000);
            [owed, last] = [due.owed, now];
            try {
                for (let step = 0; step < due.steps; step++) {
                    const before = m.debug ? performance.now() : 0;
                    scene.step?.(TICK);
                    if (m.debug) took += (performance.now() - before - took) * 0.05;
                    m.time += TICK;
                }
                draw();
            } catch (problem) {
                // A scene that throws stops here, but not for good: the next touch or scroll starts it again.
                frame = 0;
                throw problem;
            }
            if (scene.resting?.()) {
                frame = 0;
                return;
            }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
    }

    // A press or a key anywhere in the mini, its buttons too, is the touch that lets it move under reduced motion.
    const touched = () => {
        allowed = true;
    };
    host.addEventListener("pointerdown", touched, { capture: true });
    host.addEventListener("keydown", touched, { capture: true });

    /** When and where the last press was, to tell a double one. */
    let pressed = { at: -1000, x: 0, y: 0 };
    const place = (event: PointerEvent) => {
        [m.pointer.x, m.pointer.y] = [event.offsetX, event.offsetY];
    };
    canvas.addEventListener("pointerdown", (event) => {
        // Only the main button presses: a right click, or a click with ctrl on a Mac, opens a menu and may never be let go.
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // a drag that starts on the canvas is the mini's, and must not begin selecting the page's text
        event.preventDefault();
        place(event);
        m.pointer.down = true;
        // Keep hearing about this pointer even if it leaves the canvas.
        canvas.setPointerCapture(event.pointerId);
        // It takes the keyboard too, but a ring around it is only for someone who got here by keyboard.
        canvas.dataset.touched = "";
        canvas.focus({ preventScroll: true });
        scene.press?.(m.pointer.x, m.pointer.y);
        const twice = event.timeStamp - pressed.at < 350 && Math.hypot(m.pointer.x - pressed.x, m.pointer.y - pressed.y) < 24;
        pressed = { at: twice ? -1000 : event.timeStamp, x: m.pointer.x, y: m.pointer.y };
        if (twice) scene.double?.(m.pointer.x, m.pointer.y);
        start();
    });
    canvas.addEventListener("pointermove", (event) => {
        place(event);
        scene.move?.(m.pointer.x, m.pointer.y);
    });
    const up = (event: PointerEvent) => {
        place(event);
        if (m.pointer.down) scene.release?.(m.pointer.x, m.pointer.y);
        m.pointer.down = false;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up);
    canvas.addEventListener("pointerenter", () => {
        m.pointer.inside = true;
        if (allowed) start();
    });
    canvas.addEventListener("pointerleave", () => {
        m.pointer.inside = false;
    });
    // Keys only count while the mini has the keyboard, so the page still scrolls otherwise.
    canvas.addEventListener("keydown", (event) => {
        const name = named(event);
        if (event.key === "Tab") delete canvas.dataset.touched;
        if (!name || event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        if (!held.has(name)) scene.keydown?.(name);
        held.add(name);
        start();
    });
    canvas.addEventListener("keyup", (event) => {
        const name = named(event);
        if (name) held.delete(name);
    });
    canvas.addEventListener("blur", () => {
        held.clear();
        delete canvas.dataset.touched;
    });

    const resizer = new ResizeObserver(() => {
        fit();
        scene.resize?.();
        draw();
    });
    resizer.observe(canvas);
    // Only run while it can be seen.
    const watcher = new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible && allowed) start();
        else stop();
    });
    watcher.observe(canvas);
    const shown = () => (document.hidden ? stop() : allowed && start());
    document.addEventListener("visibilitychange", shown);

    draw();
    return () => {
        stop();
        resizer.disconnect();
        watcher.disconnect();
        document.removeEventListener("visibilitychange", shown);
        host.removeEventListener("pointerdown", touched, { capture: true });
        host.removeEventListener("keydown", touched, { capture: true });
        canvas.remove();
    };
}
