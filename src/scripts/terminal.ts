// A small terminal for showing command-line and full-screen programs on the
// site. It is a player, not a shell: it is given what a program printed and
// shows it as a terminal would, a grid of cells that understands the usual
// codes for color, moving the cursor and clearing. Nothing runs.
//
// Two kinds of thing can be played:
//   a session   steps written by hand from a program's real output:
//               ["type", "mfy --help"], ["out", "…"], ["wait", 800]
//   a recording an asciinema .cast file, played at the speed it was made

type Step = ["type", string] | ["out", string] | ["wait", number] | ["clear"];
interface Session {
    cols: number;
    rows: number;
    prompt?: string;
    steps: Step[];
}

interface Cell {
    text: string;
    /** A class for one of the sixteen colors, or a color itself. */
    fg: string;
    bg: string;
    bold: boolean;
    dim: boolean;
    flip: boolean;
}

const blank = (): Cell => ({ text: " ", fg: "", bg: "", bold: false, dim: false, flip: false });

/** The grid, and the reading of what is written to it. */
class Screen {
    cells: Cell[][] = [];
    x = 0;
    y = 0;
    shown = true;
    #pen = blank();
    #saved: [number, number] = [0, 0];
    /** A code that has started and not yet finished, kept until the rest arrives. */
    #left = "";

    constructor(readonly cols: number, readonly rows: number) {
        this.clear();
    }

    clear(): void {
        this.cells = Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, blank));
        [this.x, this.y] = [0, 0];
    }

    #down(): void {
        if (this.y < this.rows - 1) this.y++;
        else {
            this.cells.shift();
            this.cells.push(Array.from({ length: this.cols }, blank));
        }
    }

    write(text: string): void {
        const all = this.#left + text;
        this.#left = "";
        for (let at = 0; at < all.length; at++) {
            const letter = all[at]!;
            if (letter === "\x1b") {
                // a code: ESC [ numbers letter, or ESC ] … for a title, which is skipped
                const rest = all.slice(at);
                const code = /^\x1b\[([?>=]?)([\d;:]*)([ -/]*)([@-~])/.exec(rest) ?? /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(rest) ?? /^\x1b[()][A-Z0-9]/.exec(rest) ?? /^\x1b[=>78DMEHc]/.exec(rest);
                if (!code) {
                    if (rest.length < 24) {
                        this.#left = rest;
                        return;
                    }
                    continue;
                }
                at += code[0].length - 1;
                if (code[4]) this.#code(code[1] ?? "", (code[2] ?? "").split(/[;:]/).map((part) => (part === "" ? -1 : Number(part))), code[4]);
                else if (code[0] === "\x1b7") this.#saved = [this.x, this.y];
                else if (code[0] === "\x1b8") [this.x, this.y] = this.#saved;
                continue;
            }
            if (letter === "\n") this.#down();
            else if (letter === "\r") this.x = 0;
            else if (letter === "\b") this.x = Math.max(0, this.x - 1);
            else if (letter === "\t") this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
            else if (letter >= " ") {
                // a whole character, even one made of two halves
                const point = all.codePointAt(at)!;
                const whole = String.fromCodePoint(point);
                at += whole.length - 1;
                if (this.x >= this.cols) {
                    this.x = 0;
                    this.#down();
                }
                this.cells[this.y]![this.x] = { ...this.#pen, text: whole };
                this.x++;
            }
        }
    }

    #code(mark: string, given: number[], letter: string): void {
        const n = (index: number, otherwise: number) => (given[index] === undefined || given[index] < 0 ? otherwise : given[index]);
        const row = this.cells[this.y]!;
        if (mark === "?") {
            if (given.includes(25)) this.shown = letter === "h";
            // the other screen that full-screen programs draw on: it starts empty
            if (given.includes(1049) || given.includes(47)) this.clear();
            return;
        }
        if (letter === "m") return this.#color(given.map((part) => Math.max(0, part)));
        if (letter === "A") this.y = Math.max(0, this.y - n(0, 1));
        else if (letter === "B") this.y = Math.min(this.rows - 1, this.y + n(0, 1));
        else if (letter === "C") this.x = Math.min(this.cols - 1, this.x + n(0, 1));
        else if (letter === "D") this.x = Math.max(0, this.x - n(0, 1));
        else if (letter === "G") this.x = Math.min(this.cols - 1, n(0, 1) - 1);
        else if (letter === "d") this.y = Math.min(this.rows - 1, n(0, 1) - 1);
        else if (letter === "H" || letter === "f") [this.y, this.x] = [Math.min(this.rows - 1, n(0, 1) - 1), Math.min(this.cols - 1, n(1, 1) - 1)];
        else if (letter === "s") this.#saved = [this.x, this.y];
        else if (letter === "u") [this.x, this.y] = this.#saved;
        else if (letter === "K") {
            const [from, to] = n(0, 0) === 0 ? [this.x, this.cols] : n(0, 0) === 1 ? [0, this.x + 1] : [0, this.cols];
            for (let x = from; x < to; x++) row[x] = blank();
        } else if (letter === "J") {
            const how = n(0, 0);
            if (how >= 2) {
                const [x, y] = [this.x, this.y];
                this.clear();
                [this.x, this.y] = [x, y];
            } else {
                for (let x = how ? 0 : this.x; x < (how ? this.x + 1 : this.cols); x++) row[x] = blank();
                for (let y = how ? 0 : this.y + 1; y < (how ? this.y : this.rows); y++) this.cells[y] = Array.from({ length: this.cols }, blank);
            }
        } else if (letter === "X") for (let x = this.x; x < Math.min(this.cols, this.x + n(0, 1)); x++) row[x] = blank();
    }

    #color(given: number[]): void {
        const pen = this.#pen;
        if (given.length === 0) given = [0];
        for (let at = 0; at < given.length; at++) {
            const code = given[at]!;
            const ground = code >= 40 && code !== 90 && (code < 50 || code >= 100);
            const set = (value: string) => (ground ? (pen.bg = value) : (pen.fg = value));
            if (code === 0) Object.assign(pen, blank());
            else if (code === 1) pen.bold = true;
            else if (code === 2) pen.dim = true;
            else if (code === 7) pen.flip = true;
            else if (code === 22) pen.bold = pen.dim = false;
            else if (code === 27) pen.flip = false;
            else if (code === 39) pen.fg = "";
            else if (code === 49) pen.bg = "";
            else if ((code >= 30 && code <= 37) || (code >= 40 && code <= 47)) set(`c${code % 10}`);
            else if ((code >= 90 && code <= 97) || (code >= 100 && code <= 107)) set(`c${(code % 10) + 8}`);
            else if (code === 38 || code === 48) {
                const where = code === 48 ? "bg" : "fg";
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

/** One of the 256 colors: the first sixteen are the theme's, then a cube of colors and a run of grays. */
function palette(number: number): string {
    if (number < 16) return `c${number}`;
    if (number >= 232) return `rgb(${[0, 0, 0].map(() => 8 + (number - 232) * 10).join(" ")})`;
    const levels = [0, 95, 135, 175, 215, 255];
    const index = number - 16;
    return `rgb(${levels[Math.floor(index / 36)]} ${levels[Math.floor(index / 6) % 6]} ${levels[index % 6]})`;
}

/** Puts the grid on the page: one line an element, runs of like cells a span each. Only lines that changed are redrawn. */
function paintScreen(screen: Screen, into: HTMLElement, was: string[], cursor: boolean): void {
    while (into.children.length < screen.rows) into.append(document.createElement("div"));
    screen.cells.forEach((row, y) => {
        const key = JSON.stringify(row) + (cursor && screen.shown && y === screen.y ? `@${screen.x}` : "");
        if (was[y] === key) return;
        was[y] = key;
        const line = into.children[y]!;
        line.replaceChildren();
        let run: HTMLSpanElement | undefined;
        let like = "";
        row.forEach((cell, x) => {
            const here = cursor && screen.shown && y === screen.y && x === screen.x;
            const flip = cell.flip !== here;
            const [fg, bg] = flip ? [cell.bg || "ground", cell.fg || "ink"] : [cell.fg, cell.bg];
            const style = `${fg}|${bg}|${cell.bold}|${cell.dim}`;
            if (!run || style !== like) {
                run = document.createElement("span");
                like = style;
                for (const [value, kind] of [[fg, "fg"], [bg, "bg"]] as const) {
                    if (!value) continue;
                    if (/^(c\d+|ink|ground)$/.test(value)) run.classList.add(`${kind}-${value}`);
                    else run.style[kind === "fg" ? "color" : "backgroundColor"] = value;
                }
                if (cell.bold) run.classList.add("bold");
                if (cell.dim) run.classList.add("dim");
                line.append(run);
            }
            run.textContent += cell.text;
        });
    });
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

for (const host of document.querySelectorAll<HTMLElement>("[data-terminal]")) {
    const view = host.querySelector<HTMLElement>(".terminal-screen");
    const again = host.querySelector<HTMLButtonElement>(".terminal-again");
    if (!view) continue;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    /** Each play has a number; a play stops when it is no longer the latest, or the terminal is off screen. */
    let play = 0;
    let visible = false;
    let finished = false;

    const run = async (): Promise<void> => {
        const mine = ++play;
        finished = false;
        const live = () => mine === play;
        /** Waits, and waits longer while the terminal cannot be seen. */
        const rest = async (ms: number) => {
            if (still) return;
            await pause(ms);
            while (live() && !visible) await pause(200);
        };
        const was: string[] = [];
        let screen: Screen;
        const show = (cursor = true) => paintScreen(screen, view, was, cursor);

        const cast = host.dataset.cast;
        if (cast) {
            // a recording: a first line that says its size, then [seconds, "o", text] on each line after
            const lines = (await (await fetch(cast)).text()).trim().split("\n");
            const head = JSON.parse(lines[0]!) as { width: number; height: number };
            screen = new Screen(head.width, head.height);
            let before = 0;
            for (const line of lines.slice(1)) {
                const [at, kind, text] = JSON.parse(line) as [number, string, string];
                if (kind !== "o") continue;
                // a long silence in a recording is cut to two seconds
                await rest(Math.min(2000, (at - before) * 1000));
                before = at;
                if (!live()) return;
                screen.write(text);
                show();
            }
        } else {
            const session = JSON.parse(host.querySelector('script[type="application/json"]')?.textContent ?? "{}") as Session;
            screen = new Screen(session.cols, session.rows);
            const prompt = session.prompt ?? "\x1b[35m$\x1b[0m ";
            for (const step of session.steps) {
                if (!live()) return;
                if (step[0] === "type") {
                    screen.write(prompt);
                    show();
                    await rest(500);
                    for (const letter of step[1]) {
                        if (!live()) return;
                        screen.write(letter);
                        show();
                        await rest(35 + Math.random() * 70);
                    }
                    await rest(350);
                    screen.write("\r\n");
                } else if (step[0] === "out") {
                    // a line at a time, as a program prints
                    for (const line of step[1].replace(/\r?\n/g, "\r\n").split(/(?<=\n)/)) {
                        if (!live()) return;
                        screen.write(line);
                        show();
                        await rest(18);
                    }
                } else if (step[0] === "wait") await rest(step[1]);
                else screen.clear();
                show();
            }
            screen.write(prompt);
        }
        show(!still);
        finished = true;
        if (again) again.hidden = false;
    };

    again?.addEventListener("click", () => {
        again.hidden = true;
        void run();
    });
    // It starts when it is first scrolled to, and holds still while out of view.
    new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible && play === 0 && !finished) void run();
    }, { threshold: 0.3 }).observe(host);
}

export {};
