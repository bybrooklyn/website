// A terminal for showing command-line and full-screen programs on the site.
// It plays a recording of a real run (an asciinema .cast file in
// public/casts/): what the program printed, with its timing. Nothing runs.
//
// `Screen` is the terminal itself: a grid of cells, and the reading of the
// codes programs send to color text, move about, scroll part of the screen,
// insert and delete, and switch to a second screen and back. The rest of the
// file puts a Screen on the page and plays a recording into it.
// terminal.test.ts holds Screen to what each code means.

import { boxOf, round, shade, travel } from "./opening";

export interface Cell {
    /** One character; empty for the second half of a wide one. */
    text: string;
    /** Colors as CSS, or empty for the terminal's own. */
    fg: string;
    bg: string;
    bold: boolean;
    dim: boolean;
    flip: boolean;
    italic: boolean;
    under: boolean;
    strike: boolean;
}

const blank = (): Cell => ({ text: " ", fg: "", bg: "", bold: false, dim: false, flip: false, italic: false, under: false, strike: false });

/** Marks that sit on the character before them, and characters two cells wide. */
const JOINS = /^[\p{M}‍︎️]$/u;
const WIDE = /^[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}]$/u;

/** One of the 256 colors: the first sixteen are the theme's, then a cube of colors and a run of grays. */
function palette(number: number): string {
    if (number < 16) return `var(--c${number})`;
    if (number >= 232) return `rgb(${[0, 0, 0].map(() => 8 + (number - 232) * 10).join(" ")})`;
    const levels = [0, 95, 135, 175, 215, 255];
    const index = number - 16;
    return `rgb(${levels[Math.floor(index / 36)]} ${levels[Math.floor(index / 6) % 6]} ${levels[index % 6]})`;
}

/** What each plain styling code switches. */
const STYLES: Record<number, Partial<Cell>> = {
    1: { bold: true }, 2: { dim: true }, 3: { italic: true }, 4: { under: true }, 7: { flip: true }, 9: { strike: true },
    22: { bold: false, dim: false }, 23: { italic: false }, 24: { under: false }, 27: { flip: false }, 29: { strike: false },
    39: { fg: "" }, 49: { bg: "" },
};

export class Screen {
    cells: Cell[][] = [];
    x = 0;
    y = 0;
    /** Whether the cursor is shown. */
    shown = true;
    #pen = blank();
    #saved: [number, number] = [0, 0];
    /** The part of the screen that scrolls: its first and last lines. */
    #top = 0;
    #bottom: number;
    /** The ordinary screen, kept while a full-screen program is on the other one. */
    #main?: { cells: Cell[][]; x: number; y: number };
    /** The last character written, for the code that repeats it. */
    #last = " ";
    /** A code that has started and not yet finished, kept until the rest arrives. */
    #left = "";

    constructor(readonly cols: number, readonly rows: number) {
        this.#bottom = rows - 1;
        this.clear();
    }

    #line = (): Cell[] => Array.from({ length: this.cols }, blank);

    clear(): void {
        this.cells = Array.from({ length: this.rows }, this.#line);
        [this.x, this.y] = [0, 0];
    }

    /** The lines as plain text, for looking at and for tests. */
    get text(): string[] {
        return this.cells.map((row) => row.map((cell) => cell.text).join("").trimEnd());
    }

    /** Moves the lines of the scrolling part up (or, with a negative count, down), from `from` to its end. New lines are empty. */
    #scroll(count: number, from = this.#top): void {
        for (let n = Math.abs(count); n > 0; n--) {
            this.cells.splice(count > 0 ? from : this.#bottom, 1);
            this.cells.splice(count > 0 ? this.#bottom : from, 0, this.#line());
        }
    }

    #down(): void {
        if (this.y === this.#bottom) this.#scroll(1);
        else if (this.y < this.rows - 1) this.y++;
    }

    #put(whole: string): void {
        if (JOINS.test(whole)) {
            // it belongs to the character before it
            const before = this.cells[this.y]![Math.max(0, this.x - 1)]!;
            if (before.text) before.text += whole;
            return;
        }
        const wide = WIDE.test(whole);
        if (this.x + (wide ? 1 : 0) >= this.cols) {
            this.x = 0;
            this.#down();
        }
        const row = this.cells[this.y]!;
        row[this.x++] = { ...this.#pen, text: whole };
        if (wide) row[this.x++] = { ...this.#pen, text: "" };
        this.#last = whole;
    }

    write(text: string): void {
        const all = this.#left + text;
        this.#left = "";
        for (let at = 0; at < all.length; at++) {
            const letter = all[at]!;
            if (letter === "\x1b") {
                const rest = all.slice(at);
                // ESC [ … a letter; a title or other string up to its end mark; a choice of character set; a single letter
                const code =
                    /^\x1b\[([<=>?]?)([\d;:]*)([ -/]*)([@-~])/.exec(rest) ??
                    /^\x1b[\]P_^X][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(rest) ??
                    /^\x1b[()*+][A-Z0-9]/.exec(rest) ??
                    /^\x1b[=>78DMEHc]/.exec(rest);
                if (!code) {
                    // Not all of it has arrived yet: kept for next time. (If it never ends, it is dropped.)
                    if (rest.length < (/^\x1b[\]P_^X]/.test(rest) ? 4096 : 32)) {
                        this.#left = rest;
                        return;
                    }
                    continue;
                }
                at += code[0].length - 1;
                if (code[4]) this.#code(code[1] ?? "", (code[2] ?? "").split(/[;:]/).map((part) => (part === "" ? -1 : Number(part))), code[3] ?? "", code[4]);
                else if (code[0] === "\x1b7") this.#saved = [this.x, this.y];
                else if (code[0] === "\x1b8") [this.x, this.y] = this.#saved;
                else if (code[0] === "\x1bD") this.#down();
                else if (code[0] === "\x1bE") [this.x] = [0, this.#down()];
                else if (code[0] === "\x1bM") {
                    // up a line; at the top of the scrolling part, everything in it moves down
                    if (this.y === this.#top) this.#scroll(-1);
                    else this.y = Math.max(0, this.y - 1);
                } else if (code[0] === "\x1bc") [this.#top, this.#bottom, this.#pen] = [0, this.rows - 1, (this.clear(), blank())];
                continue;
            }
            if (letter === "\n") this.#down();
            else if (letter === "\r") this.x = 0;
            else if (letter === "\b") this.x = Math.max(0, this.x - 1);
            else if (letter === "\t") this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
            else if (letter >= " ") {
                // a whole character, even one made of two halves
                const whole = String.fromCodePoint(all.codePointAt(at)!);
                at += whole.length - 1;
                this.#put(whole);
            }
        }
    }

    #code(mark: string, given: number[], between: string, letter: string): void {
        // Questions put to the terminal, and the keyboard's settings: nothing to draw.
        if (between || (mark && mark !== "?")) return;
        const n = (index: number, otherwise: number) => (given[index] === undefined || given[index] < 0 ? otherwise : given[index]);
        const [count, last] = [Math.max(1, n(0, 1)), this.cols - 1];
        const row = this.cells[this.y]!;
        const inside = this.y >= this.#top && this.y <= this.#bottom;
        if (mark === "?") {
            if (letter !== "h" && letter !== "l") return;
            if (given.includes(25)) this.shown = letter === "h";
            if (given.includes(1049) || given.includes(1047) || given.includes(47)) {
                // the other screen that full-screen programs draw on: it starts empty, and the first comes back after
                if (letter === "h" && !this.#main) {
                    this.#main = { cells: this.cells, x: this.x, y: this.y };
                    this.clear();
                } else if (letter === "l" && this.#main) {
                    ({ cells: this.cells, x: this.x, y: this.y } = this.#main);
                    this.#main = undefined;
                }
                [this.#top, this.#bottom] = [0, this.rows - 1];
            }
        } else if (letter === "m") this.#color(given.map((part) => Math.max(0, part)));
        else if (letter === "A") this.y = Math.max(0, this.y - count);
        else if (letter === "B" || letter === "e") this.y = Math.min(this.rows - 1, this.y + count);
        else if (letter === "C" || letter === "a") this.x = Math.min(last, this.x + count);
        else if (letter === "D") this.x = Math.max(0, Math.min(last, this.x) - count);
        else if (letter === "E") [this.x, this.y] = [0, Math.min(this.rows - 1, this.y + count)];
        else if (letter === "F") [this.x, this.y] = [0, Math.max(0, this.y - count)];
        else if (letter === "G" || letter === "`") this.x = Math.min(last, count - 1);
        else if (letter === "d") this.y = Math.min(this.rows - 1, count - 1);
        else if (letter === "H" || letter === "f") [this.y, this.x] = [Math.min(this.rows - 1, count - 1), Math.min(last, Math.max(1, n(1, 1)) - 1)];
        else if (letter === "s") this.#saved = [this.x, this.y];
        else if (letter === "u") [this.x, this.y] = this.#saved;
        else if (letter === "r") {
            // the part of the screen that scrolls; the cursor goes home
            const [top, bottom] = [count - 1, Math.min(this.rows, n(1, this.rows)) - 1];
            if (top < bottom) [this.#top, this.#bottom, this.x, this.y] = [top, bottom, 0, 0];
        } else if (letter === "S") this.#scroll(count);
        else if (letter === "T") this.#scroll(-count);
        else if (letter === "L" && inside) [this.x] = [0, this.#scroll(-count, this.y)];
        else if (letter === "M" && inside) [this.x] = [0, this.#scroll(count, this.y)];
        else if (letter === "@") row.splice(this.x, 0, ...Array.from({ length: Math.min(count, this.cols - this.x) }, blank)), (row.length = this.cols);
        else if (letter === "P") row.splice(this.x, Math.min(count, this.cols - this.x)), row.push(...Array.from({ length: this.cols - row.length }, blank));
        else if (letter === "b") for (let k = 0; k < count; k++) this.#put(this.#last);
        else if (letter === "X") for (let x = this.x; x < Math.min(this.cols, this.x + count); x++) row[x] = blank();
        else if (letter === "K") {
            const [from, to] = n(0, 0) === 0 ? [this.x, this.cols] : n(0, 0) === 1 ? [0, this.x + 1] : [0, this.cols];
            for (let x = from; x < to; x++) row[x] = blank();
        } else if (letter === "J") {
            const how = n(0, 0);
            if (how >= 2) for (let y = 0; y < this.rows; y++) this.cells[y] = this.#line();
            else {
                for (let x = how ? 0 : this.x; x < (how ? this.x + 1 : this.cols); x++) row[x] = blank();
                for (let y = how ? 0 : this.y + 1; y < (how ? this.y : this.rows); y++) this.cells[y] = this.#line();
            }
        }
    }

    #color(given: number[]): void {
        const pen = this.#pen;
        if (given.length === 0) given = [0];
        for (let at = 0; at < given.length; at++) {
            const code = given[at]!;
            const where = (code >= 40 && code < 50) || code >= 100 ? "bg" : "fg";
            if (code === 0) Object.assign(pen, blank(), { text: pen.text });
            else if (STYLES[code]) Object.assign(pen, STYLES[code]);
            else if ((code >= 30 && code <= 37) || (code >= 40 && code <= 47)) pen[where] = palette(code % 10);
            else if ((code >= 90 && code <= 97) || (code >= 100 && code <= 107)) pen[where] = palette((code % 10) + 8);
            else if (code === 38 || code === 48) {
                if (given[at + 1] === 5) {
                    pen[where] = palette(given[at + 2] ?? 0);
                    at += 2;
                } else if (given[at + 1] === 2) {
                    pen[where] = `rgb(${given[at + 2] ?? 0} ${given[at + 3] ?? 0} ${given[at + 4] ?? 0})`;
                    at += 4;
                }
            }
        }
    }
}

/**
 * Puts the grid on the page: one line an element, runs of like cells a span each. Only lines that
 * changed are redrawn. Anything that is not a plain letter gets a box of its own, exactly one cell
 * (or two) wide, so that lines and borders meet whatever face the browser finds them in.
 */
function paint(screen: Screen, into: HTMLElement, was: string[], cursor: boolean): void {
    while (into.children.length < screen.rows) into.append(document.createElement("div"));
    screen.cells.forEach((row, y) => {
        const here = cursor && screen.shown && y === screen.y ? Math.min(screen.x, screen.cols - 1) : -1;
        const key = `${JSON.stringify(row)}@${here}`;
        if (was[y] === key) return;
        was[y] = key;
        const line = into.children[y]!;
        line.replaceChildren();
        let run: HTMLSpanElement | undefined;
        let like = "";
        row.forEach((cell, x) => {
            if (!cell.text) return;
            const flip = cell.flip !== (x === here);
            const [fg, bg] = flip ? [cell.bg || "var(--term-ground)", cell.fg || "var(--term-ink)"] : [cell.fg, cell.bg];
            const own = cell.text > " " || cell.text.length > 1;
            const style = `${fg}|${bg}|${cell.bold}|${cell.dim}|${cell.italic}|${cell.under}|${cell.strike}|${x === here}`;
            if (!run || own || style !== like) {
                run = document.createElement("span");
                like = own ? "" : style;
                run.style.color = fg;
                run.style.backgroundColor = bg;
                run.className = [cell.bold && "bold", cell.dim && "dim", cell.italic && "italic", cell.under && "under", cell.strike && "strike", x === here && "cursor", own && (row[x + 1]?.text === "" ? "wide" : "cell")].filter(Boolean).join(" ");
                line.append(run);
            }
            run.textContent += cell.text;
        });
    });
}

interface Cast {
    cols: number;
    rows: number;
    /** The moment, in seconds, to show while it is not playing. */
    poster: number;
    events: [at: number, text: string][];
}

async function load(address: string): Promise<Cast> {
    // a recording: a first line that says its size, then [seconds, "o", text] on each line after
    const lines = (await (await fetch(address)).text()).trim().split("\n");
    const head = JSON.parse(lines[0]!) as { width: number; height: number; poster?: number };
    const events = lines.slice(1).map((line) => JSON.parse(line) as [number, string, string]).filter(([, kind]) => kind === "o");
    return { cols: head.width, rows: head.height, poster: head.poster ?? Infinity, events: events.map(([at, , text]) => [at, text]) };
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

if (typeof document !== "undefined") {
    for (const host of document.querySelectorAll<HTMLElement>("[data-terminal]")) {
        const view = host.querySelector<HTMLElement>(".terminal-screen");
        const fit = host.querySelector<HTMLElement>(".terminal-fit");
        const again = host.querySelector<HTMLButtonElement>(".terminal-again");
        const grow = host.querySelector<HTMLButtonElement>(".terminal-grow");
        if (!view || !fit || !host.dataset.cast) continue;
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        /** Each play has a number; a play stops when it is no longer the latest. */
        let play = 0;
        let visible = false;
        let cast: Cast | undefined;

        /** The type is sized so that the recording's columns fill the room there is, and its lines fit when it is open full size. */
        const size = () => {
            if (!cast) return;
            const probe = document.createElement("span");
            probe.textContent = "0".repeat(50);
            probe.style.cssText = "position:absolute;visibility:hidden;font-size:100px";
            view.append(probe);
            const wide = probe.getBoundingClientRect().width / 5000;
            probe.remove();
            const across = fit.clientWidth - 2 * Number.parseFloat(getComputedStyle(fit).paddingLeft);
            // open, its lines must fit the window too: the window's height less the bar's, which is the frame's height less the screen's
            const frame = host.querySelector<HTMLElement>(".terminal-window") ?? fit;
            const down = host.classList.contains("open") ? (innerHeight * 0.92 - (frame.clientHeight - fit.clientHeight) - 2 * Number.parseFloat(getComputedStyle(fit).paddingTop)) / (cast.rows * 1.3) : Infinity;
            view.style.fontSize = `${Math.min(across / (cast.cols * wide), down, host.classList.contains("open") ? 22 : 15)}px`;
        };

        const run = async (whole: boolean): Promise<void> => {
            const mine = ++play;
            cast ??= await load(host.dataset.cast!);
            host.style.setProperty("--cols", String(cast.cols));
            host.style.setProperty("--rows", String(cast.rows));
            size();
            const screen = new Screen(cast.cols, cast.rows);
            const was: string[] = [];
            again?.classList.remove("shown");
            let before = 0;
            for (const [at, text] of cast.events) {
                if (!whole && at > cast.poster) break;
                if (whole) {
                    // at the speed it was made, except that a long silence is cut short; and it waits while it cannot be seen
                    await pause(Math.min(1400, (at - before) * 1000));
                    while (mine === play && !visible) await pause(200);
                    if (mine !== play) return;
                }
                before = at;
                screen.write(text);
                if (whole) paint(screen, view, was, true);
            }
            // at rest it shows the moment chosen for it, not the empty screen a program leaves behind
            if (whole && cast.poster < Infinity) return run(false);
            paint(screen, view, was, false);
            if (again) {
                const words = whole || !still ? "Play again" : "Play";
                [again.dataset.shows, again.ariaLabel, again.title] = [words === "Play" ? "play" : "again", words, words];
                again.classList.add("shown");
            }
        };

        again?.addEventListener("click", () => void run(true));
        // Open, it fills the window; a click outside it, Escape, or the button again puts it back. It travels
        // there from where it sits on the page and back again, over a shade, as a picture does (opening.ts).
        const frame = host.querySelector<HTMLElement>(".terminal-window") ?? fit;
        let cover: ReturnType<typeof shade> | undefined;
        /** Keeps the terminal's room in the page while it is out of it, so the page under it does not move. */
        let room: HTMLElement | undefined;
        const open = (to: boolean, moving = true) => {
            if (to === host.classList.contains("open")) return;
            const from = boxOf(frame);
            if (to) {
                room = document.createElement("div");
                room.style.height = `${host.offsetHeight}px`;
                room.style.margin = getComputedStyle(host).margin;
                host.before(room);
                cover = shade("terminal-shade", host);
            } else {
                room?.remove();
                cover?.lift();
            }
            host.classList.toggle("open", to);
            document.documentElement.classList.toggle("terminal-open", to);
            if (grow) [grow.dataset.shows, grow.ariaLabel, grow.title, grow.ariaExpanded] = [to ? "close" : "grow", to ? "Close" : "Full size", to ? "Close" : "Full size", String(to)];
            size();
            if (!moving) return;
            // on its way back it stays above the shade that is fading under it
            host.classList.add("travelling");
            const arrived = () => host.classList.remove("travelling");
            travel(frame, from, to ? 420 : 340).finished.then(arrived, arrived);
        };
        grow?.addEventListener("click", () => open(!host.classList.contains("open")));
        host.addEventListener("click", (event) => event.target === host && open(false));
        document.addEventListener("keydown", (event) => {
            if (!host.classList.contains("open")) return;
            if (event.key === "Escape") {
                open(false);
                grow?.focus({ preventScroll: true });
            } else if (event.key === "Tab") {
                // open, it is the whole window: Tab goes round its own buttons and not to the page under it
                round(event, [...host.querySelectorAll<HTMLElement>("button.shown, button.terminal-grow")]);
            }
        });
        // leaving the page closes it, so it is not still open, with the page locked under it, when the page is come back to
        for (const leaving of ["pageswap", "pagehide"]) addEventListener(leaving, () => open(false, false));
        new ResizeObserver(size).observe(fit);

        // It is fetched and starts when it is first scrolled to, and holds still while out of view.
        new IntersectionObserver(([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            if (visible && play === 0) void run(!still);
        }, { threshold: 0.3 }).observe(host);
    }
}
