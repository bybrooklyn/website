// A small driver for the system's headless Chromium, over its debugging port: open a page, run
// script in it, click, photograph. `bun run pictures` and the drawing test use it. No dependency.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Browser {
    /** Goes to an address and waits for the page to load, then `settle` milliseconds more. */
    open(url: string, settle?: number): Promise<void>;
    /** Runs an expression in the page and gives back its value. */
    run<T = unknown>(expression: string): Promise<T>;
    click(x: number, y: number): Promise<void>;
    /** Presses the mouse at one place, moves it in `steps` even steps to another with the button held, and lets go there. */
    drag(from: { x: number; y: number }, to: { x: number; y: number }, steps?: number): Promise<void>;
    /** Presses and lets go of a key, such as "ArrowRight" or "Tab", in whatever has the focus. */
    press(key: string): Promise<void>;
    wait(ms: number): Promise<void>;
    /** A PNG of the window, or of one rectangle of the page. */
    picture(clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer>;
    /** Errors the page has thrown or logged since it was opened. */
    errors: string[];
    close(): Promise<void>;
}

/** Where Chromium is, or undefined if this machine has none. */
export const chromium = (): string | undefined => ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((name) => Bun.which(name)).find(Boolean) ?? undefined;

export async function browser({ width = 1200, height = 800, scale = 1, port = 9400 + Math.floor(Math.random() * 500) } = {}): Promise<Browser> {
    const program = chromium();
    if (!program) throw new Error("No Chromium on this machine.");
    const profile = await mkdtemp(join(tmpdir(), "site-browser-"));
    // SwiftShader draws WebGL without a graphics card, the same on every machine.
    const chrome = spawn(program, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
    const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

    let page: { webSocketDebuggerUrl: string } | undefined;
    for (let tries = 0; tries < 50 && !page; tries++) {
        await wait(100);
        const targets = await fetch(`http://localhost:${port}/json`).then((answer) => answer.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>, () => []);
        page = targets.find((target) => target.type === "page");
    }
    if (!page) throw new Error("Chromium did not start.");

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((opened) => (socket.onopen = opened));
    const errors: string[] = [];
    const waiting = new Map<number, (answer: any) => void>();
    let loaded = () => {};
    let sent = 0;
    socket.onmessage = (message) => {
        const said = JSON.parse(String(message.data));
        if (said.id) waiting.get(said.id)?.(said.result ?? {});
        if (said.method === "Page.loadEventFired") loaded();
        if (said.method === "Runtime.exceptionThrown") errors.push(said.params.exceptionDetails.exception?.description ?? said.params.exceptionDetails.text);
        if (said.method === "Runtime.consoleAPICalled" && said.params.type === "error") errors.push(said.params.args.map((arg: any) => arg.value ?? arg.description).join(" "));
    };
    const send = (method: string, params: object = {}) =>
        new Promise<any>((answer) => {
            waiting.set(++sent, answer);
            socket.send(JSON.stringify({ id: sent, method, params }));
        });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    const mouse = (type: string, x: number, y: number, held = type === "mousePressed") => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: held ? 1 : 0, clickCount: 1 });

    return {
        errors,
        wait,
        async open(url, settle = 500) {
            errors.length = 0;
            const arrived = new Promise<void>((done) => (loaded = done));
            await send("Page.navigate", { url });
            await arrived;
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
        async press(key) {
            // Chromium acts on a key only when it is given the key's number as well as its name.
            const numbers: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
            const number = numbers[key] ?? key.toUpperCase().charCodeAt(0);
            const named = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number };
            // Enter and space also type a character, which is what presses a button.
            const typed = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
            await send("Input.dispatchKeyEvent", { type: typed ? "keyDown" : "rawKeyDown", ...named, ...(typed && { text: typed }) });
            await send("Input.dispatchKeyEvent", { type: "keyUp", ...named });
        },
        async picture(clip) {
            const shot = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip: { ...clip, scale: 1 } }) });
            return Buffer.from(shot.data, "base64");
        },
        async close() {
            chrome.kill();
            await rm(profile, { recursive: true, force: true });
        },
    };
}
