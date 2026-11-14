// A small driver for the system's headless Chromium, over its debugging port: open a page, run
// script in it, click, photograph. `bun run pictures` and the drawing test use it. No dependency.

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface Browser {
    /** Goes to an address and waits for the page to load, then `settle` milliseconds more. */
    open(url: string, settle?: number): Promise<void>;
    /** Runs an expression in the page and gives back its value. */
    run<T = unknown>(expression: string): Promise<T>;
    click(x: number, y: number): Promise<void>;
    /** Presses the mouse at one place, moves it in `steps` even steps to another with the button held, and lets go there. */
    drag(from: { x: number; y: number }, to: { x: number; y: number }, steps?: number): Promise<void>;
    /** Presses the mouse at a place and keeps it held, for a drag that takes its time: `move` it, then `up`. */
    down(x: number, y: number): Promise<void>;
    /** Moves the mouse to a place, with the button held if it is down. */
    move(x: number, y: number): Promise<void>;
    /** Lets go of the mouse at a place. */
    up(x: number, y: number): Promise<void>;
    /** One finger on a touch screen: put down, moved, or lifted at a place. */
    finger(type: "start" | "move" | "end", x: number, y: number): Promise<void>;
    /** Several fingers at once, each at its place: put down, moved, or all lifted. A finger keeps its place in the list from start to end, and is told apart from the others by it. */
    fingers(type: "start" | "move" | "end", points: { x: number; y: number }[]): Promise<void>;
    /** Presses one key as the keyboard would, with modifiers held: "Enter", "Backspace", "Tab", "ArrowLeft", a letter for a chord, or a modifier alone ("Control"). */
    press(key: string, held?: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): Promise<void>;
    /** Types text one key at a time, each a real key press. */
    type(text: string): Promise<void>;
    /** Composes text through an input method, as for Japanese: each of `steps` shown in turn, then `text` committed. */
    compose(steps: string[], text: string): Promise<void>;
    /** Makes the page see media features as given, such as `{ "prefers-reduced-motion": "reduce" }`, and print or screen media if asked; empty puts them back. */
    media(features: Record<string, string>, type?: "print" | "screen" | ""): Promise<void>;
    /** Changes the window's size. */
    resize(width: number, height: number): Promise<void>;
    /** Answers every file chooser the page opens from now on with these files, instead of a dialog nobody can close. */
    files(paths: string[]): Promise<void>;
    wait(ms: number): Promise<void>;
    /** A PNG of the window, or of one rectangle of the page. */
    picture(clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer>;
    /** Errors the page has thrown or logged since it was opened. */
    errors: string[];
    close(): Promise<void>;
}

/** Where Chromium is, or undefined if this machine has none. Written without Bun's own calls, since the resume's PDF is printed from inside Astro, which runs on Node. */
export function chromium(): string | undefined {
    for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
        for (const folder of (process.env.PATH ?? "").split(delimiter)) {
            if (folder && existsSync(join(folder, name))) return join(folder, name);
        }
    }
    return undefined;
}

/** How long one call to the browser may take before it is given up as hung. */
const PATIENCE = 30_000;

/**
 * What stops each browser still open, at once and without waiting, for when the script ends. One
 * set of handlers serves every browser, so that many browsers in one test run do not pile up listeners.
 */
const open = new Set<() => void>();
let watching = false;
function watch() {
    if (watching) return;
    watching = true;
    const all = () => {
        for (const tidy of open) tidy();
    };
    process.once("exit", all);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(signal, () => {
            all();
            process.exit(signal === "SIGINT" ? 130 : 143);
        });
    }
}

/** Whether nothing is listening on a port of this computer, so that a browser can be given it. */
const free = (port: number) =>
    new Promise<boolean>((answer) => {
        const probe = createServer();
        probe.once("error", () => answer(false));
        probe.listen(port, "127.0.0.1", () => probe.close(() => answer(true)));
    });

/** `args` are more command line flags for Chromium, such as a fake microphone for a test of dictation. */
export async function browser({ width = 1200, height = 800, scale = 1, port = 0, args = [] as string[] } = {}): Promise<Browser> {
    const program = chromium();
    if (!program) throw new Error("No Chromium on this machine.");
    // A port nothing else is on, so that two runs at once do not drive each other's browser.
    for (let tries = 0; port === 0 && tries < 50; tries++) {
        const tried = 9400 + Math.floor(Math.random() * 500);
        if (await free(tried)) port = tried;
    }
    if (port === 0) throw new Error("No free port for Chromium's debugging connection.");
    const profile = await mkdtemp(join(tmpdir(), "site-browser-"));
    // SwiftShader draws WebGL without a graphics card, the same on every machine. Detached, the
    // browser heads a process group of its own, so that it and all its helpers can be stopped together.
    const chrome = spawn(program, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--hide-scrollbars", ...args, "about:blank"], { stdio: "ignore", detached: true });
    const ended = new Promise<void>((done) => {
        chrome.once("exit", () => done());
        chrome.once("error", () => done());
    });
    const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    const stop = (signal: NodeJS.Signals) => {
        for (const target of [-(chrome.pid ?? 0), chrome.pid ?? 0]) {
            if (!target) continue;
            try {
                process.kill(target, signal);
                return;
            } catch {
                // gone already, or no process group: try the process alone
            }
        }
    };
    /** Whether any process of the browser's group is still there. */
    const running = () => {
        try {
            process.kill(-(chrome.pid ?? 0), 0);
            return !!chrome.pid;
        } catch {
            return false;
        }
    };
    // However the script ends (finished, thrown out of, timed out or interrupted), the browser is
    // stopped and its profile folder taken away. Left to themselves they pile up in /tmp, which on
    // many machines is kept in memory. This is the quick way, for when there is no time to wait.
    const tidy = () => {
        open.delete(tidy);
        stop("SIGKILL");
        rmSync(profile, { recursive: true, force: true });
    };
    open.add(tidy);
    watch();

    const errors: string[] = [];
    const waiting = new Map<number, { answer: (said: any) => void; fail: (error: Error) => void }>();
    let loaded: { done: () => void; fail: (error: Error) => void } | undefined;
    let chosen: string[] = [];
    let sent = 0;
    let gone: Error | undefined;
    let socket: WebSocket | undefined;
    const send = (method: string, params: object = {}) =>
        new Promise<any>((answer, fail) => {
            if (gone || !socket) return fail(gone ?? new Error("Not connected to Chromium."));
            const id = ++sent;
            const timer = setTimeout(() => {
                waiting.delete(id);
                fail(new Error(`Chromium did not answer ${method} within ${PATIENCE / 1000} s.`));
            }, PATIENCE);
            const settle =
                <T>(then: (value: T) => void) =>
                (value: T) => {
                    clearTimeout(timer);
                    waiting.delete(id);
                    then(value);
                };
            waiting.set(id, { answer: settle(answer), fail: settle(fail) });
            socket.send(JSON.stringify({ id, method, params }));
        });

    try {
        let page: { webSocketDebuggerUrl: string } | undefined;
        for (let tries = 0; tries < 50 && !page; tries++) {
            await wait(100);
            const targets = await fetch(`http://localhost:${port}/json`).then((answer) => answer.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>, () => []);
            page = targets.find((target) => target.type === "page");
        }
        if (!page) throw new Error("Chromium did not start.");

        const connection = new WebSocket(page.webSocketDebuggerUrl);
        socket = connection;
        await new Promise<void>((opened, failed) => {
            connection.onopen = () => opened();
            connection.onerror = () => failed(new Error("Could not connect to Chromium."));
        });
        // If the connection goes (Chromium crashed or was stopped), every call still waiting fails, and so does every later one.
        connection.onclose = () => {
            gone ??= new Error("The connection to Chromium closed.");
            for (const { fail } of [...waiting.values()]) fail(gone);
            loaded?.fail(gone);
        };
        connection.onmessage = (message) => {
            const said = JSON.parse(String(message.data));
            if (said.id) waiting.get(said.id)?.answer(said.result ?? {});
            if (said.method === "Page.loadEventFired") loaded?.done();
            if (said.method === "Page.fileChooserOpened" && said.params.backendNodeId) send("DOM.setFileInputFiles", { files: chosen, backendNodeId: said.params.backendNodeId }).catch(() => {});
            if (said.method === "Runtime.exceptionThrown") errors.push(said.params.exceptionDetails.exception?.description ?? said.params.exceptionDetails.text);
            if (said.method === "Runtime.consoleAPICalled" && said.params.type === "error") errors.push(said.params.args.map((arg: any) => arg.value ?? arg.description).join(" "));
        };

        await send("Page.enable");
        await send("Runtime.enable");
        // a file the page saves goes into the browser's own profile, which is taken away with it, and never into the person's Downloads folder
        await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: profile }).catch(() => {});
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    } catch (error) {
        // a browser that did not come up properly is not left running until the whole run ends
        socket?.close();
        tidy();
        throw error;
    }
    const mouse = (type: string, x: number, y: number, held = type === "mousePressed") => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: held ? 1 : 0, clickCount: 1 });
    /** Whether the mouse is held down by `down`, and whether touch has been switched on for `finger`. */
    let pressed = false;
    let touching = false;
    // the keys that are not characters, with the numbers Chromium needs as well as their names to act on them
    const named: Record<string, [number, string?]> = { Control: [17], Shift: [16], Alt: [18], Meta: [91], Enter: [13, "\r"], Backspace: [8], Tab: [9], Delete: [46], Escape: [27], " ": [32, " "], PageUp: [33], PageDown: [34], Home: [36], End: [35], ArrowLeft: [37], ArrowUp: [38], ArrowRight: [39], ArrowDown: [40] };
    const press = async (key: string, held: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => {
        const modifiers = (held.alt ? 1 : 0) | (held.ctrl ? 2 : 0) | (held.meta ? 4 : 0) | (held.shift ? 8 : 0);
        const known = named[key];
        const letter = /^[a-z]$/i.test(key);
        // a modifier pressed alone is held while it is down, as a keyboard says it is, and is known by its left key
        const own = ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 } as Record<string, number>)[key] ?? 0;
        const code = key === " " ? "Space" : own ? `${key}Left` : known ? key : letter ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : "";
        const keyCode = known ? known[0] : key.toUpperCase().charCodeAt(0);
        const chord = modifiers & ~8;
        // Enter and space also type a character, which is what presses a button
        const text = known ? known[1] : chord ? undefined : held.shift ? key.toUpperCase() : key;
        const shown = held.shift && letter ? key.toUpperCase() : key;
        await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: shown, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: modifiers | own, ...(text && { text, unmodifiedText: text }) });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: shown, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
    };

    /** Touches as the screen sends them: each finger with an id of its own, the same for as long as it is down. */
    const touch = async (type: "start" | "move" | "end", points: { x: number; y: number }[]) => {
        if (!touching) {
            touching = true;
            await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        }
        const kind = { start: "touchStart", move: "touchMove", end: "touchEnd" }[type];
        await send("Input.dispatchTouchEvent", { type: kind, touchPoints: type === "end" ? [] : points.map((point, id) => ({ ...point, id })) });
    };

    return {
        errors,
        wait,
        async open(url, settle = 500) {
            errors.length = 0;
            const arrived = new Promise<void>((done, fail) => {
                const timer = setTimeout(() => fail(new Error(`${url} did not finish loading within ${PATIENCE / 1000} s.`)), PATIENCE);
                loaded = {
                    done: () => (clearTimeout(timer), done()),
                    fail: (error) => (clearTimeout(timer), fail(error)),
                };
            });
            // if the navigation itself fails, this one is not waited for, and its failure is not left unhandled
            arrived.catch(() => {});
            await send("Page.navigate", { url });
            await arrived;
            loaded = undefined;
            await wait(settle);
        },
        async run(expression) {
            const answer = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
            return answer.result?.value;
        },
        async click(x, y) {
            await mouse("mousePressed", x, y);
            await mouse("mouseReleased", x, y);
        },
        async drag(from, to, steps = 10) {
            await mouse("mousePressed", from.x, from.y);
            for (let step = 1; step <= steps; step++) {
                await mouse("mouseMoved", from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps, true);
                await wait(16);
            }
            await mouse("mouseReleased", to.x, to.y);
        },
        async down(x, y) {
            pressed = true;
            await mouse("mousePressed", x, y);
        },
        async move(x, y) {
            await mouse("mouseMoved", x, y, pressed);
        },
        async up(x, y) {
            pressed = false;
            await mouse("mouseReleased", x, y);
        },
        async finger(type, x, y) {
            await touch(type, [{ x, y }]);
        },
        async fingers(type, points) {
            await touch(type, points);
        },
        press,
        async type(text) {
            for (const char of text) {
                await send("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char, unmodifiedText: char });
                await send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
            }
        },
        async compose(steps, text) {
            for (const shown of steps) await send("Input.imeSetComposition", { text: shown, selectionStart: shown.length, selectionEnd: shown.length });
            await send("Input.insertText", { text });
        },
        async media(features, type = "") {
            await send("Emulation.setEmulatedMedia", { media: type, features: Object.entries(features).map(([name, value]) => ({ name, value })) });
        },
        async files(paths) {
            chosen = paths;
            await send("Page.setInterceptFileChooserDialog", { enabled: true });
        },
        async resize(wide, high) {
            await send("Emulation.setDeviceMetricsOverride", { width: wide, height: high, deviceScaleFactor: scale, mobile: false });
        },
        async picture(clip) {
            const shot = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip: { ...clip, scale: 1 } }) });
            return Buffer.from(shot.data, "base64");
        },
        async close() {
            if (!open.has(tidy)) return;
            open.delete(tidy);
            gone ??= new Error("The browser was closed.");
            socket?.close();
            // asked to end and given two seconds to do it, then stopped with all its helpers; then
            // its profile is taken away, once, when nothing is left to write to it
            stop("SIGTERM");
            await Promise.race([ended, wait(2000)]);
            stop("SIGKILL");
            // the helpers take a moment to go after the signal; the group is gone when none is left to signal
            for (let waited = 0; waited < 2000 && running(); waited += 25) await wait(25);
            await rm(profile, { recursive: true, force: true }).catch(() => {});
        },
    };
}
