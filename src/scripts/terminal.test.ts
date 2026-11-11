// The terminal, held to what each code means. Run with `bun run test`.
// (The recordings were also played through a reference terminal, pyte, when they were made, and
// the two agreed on every screen.)

import { expect, test } from "bun:test";
import { Screen } from "./terminal";

const E = "\x1b[";
/** A small screen, five wide lines numbered 1 to 5, to push around. */
function five(): Screen {
    const screen = new Screen(12, 5);
    screen.write("one\r\ntwo\r\nthree\r\nfour\r\nfive");
    return screen;
}

test("plain text, line ends, and scrolling off the top", () => {
    const screen = five();
    expect(screen.text).toEqual(["one", "two", "three", "four", "five"]);
    screen.write("\r\nsix");
    expect(screen.text).toEqual(["two", "three", "four", "five", "six"]);
});

test("moving the cursor and erasing", () => {
    const screen = five();
    screen.write(`${E}2;2Hxx${E}K`);
    expect(screen.text[1]).toBe("txx");
    screen.write(`${E}4;1H${E}J`);
    expect(screen.text).toEqual(["one", "txx", "three", "", ""]);
    screen.write(`${E}1;3H${E}1K${E}3;2H${E}2X`);
    expect(screen.text).toEqual(["", "txx", "t  ee", "", ""]);
});

test("a part of the screen that scrolls, up and down, leaves the rest where it is", () => {
    const screen = five();
    screen.write(`${E}2;4r${E}S`);
    expect(screen.text).toEqual(["one", "three", "four", "", "five"]);
    screen.write(`${E}2T`);
    expect(screen.text).toEqual(["one", "", "", "three", "five"]);
    // a line feed at its last line scrolls it; a reverse one at its first scrolls it back
    screen.write(`${E}4;1H${E}Kx\n\ry`);
    expect(screen.text).toEqual(["one", "", "x", "y", "five"]);
    screen.write(`${E}2;1H\x1bMz`);
    expect(screen.text).toEqual(["one", "z", "", "x", "five"]);
});

test("inserting and deleting lines and characters, and repeating one", () => {
    const screen = five();
    screen.write(`${E}2;1H${E}L`);
    expect(screen.text).toEqual(["one", "", "two", "three", "four"]);
    screen.write(`${E}2M`);
    expect(screen.text).toEqual(["one", "three", "four", "", ""]);
    screen.write(`${E}2;2H${E}2@`);
    expect(screen.text[1]).toBe("t  hree");
    screen.write(`${E}3P`);
    expect(screen.text[1]).toBe("tree");
    screen.write(`${E}5;1H-${E}4b`);
    expect(screen.text[4]).toBe("-----");
});

test("the second screen, and the first one back afterwards", () => {
    const screen = five();
    screen.write(`${E}?1049h`);
    expect(screen.text.join("")).toBe("");
    screen.write(`menu${E}?1049l`);
    expect(screen.text).toEqual(["one", "two", "three", "four", "five"]);
    expect([screen.x, screen.y]).toEqual([4, 4]);
});

test("colors and styles", () => {
    const screen = new Screen(12, 2);
    screen.write(`${E}1;31ma${E}0;38;5;200;48;2;1;2;3mb${E}3;4;9;7mc${E}23;24;29;27;39;49md`);
    const [a, b, c, d] = screen.cells[0]!;
    expect([a!.bold, a!.fg]).toEqual([true, "var(--c1)"]);
    expect([b!.bold, b!.fg, b!.bg]).toEqual([false, "rgb(255 0 215)", "rgb(1 2 3)"]);
    expect([c!.italic, c!.under, c!.strike, c!.flip]).toEqual([true, true, true, true]);
    expect([d!.italic, d!.under, d!.strike, d!.flip, d!.fg, d!.bg]).toEqual([false, false, false, false, "", ""]);
});

test("what a program asks its terminal, and sets on its keyboard, draws nothing", () => {
    const screen = new Screen(20, 2);
    // Bubble Tea sends all of these when it starts
    screen.write(`${E}?2026$p${E}?2027$p${E}>4;2m${E}=1;1u${E}?u${E}?2004h${E}?1004h\x1b]11;?\x07\x1bPzz\x1b\\${E}<uok`);
    expect(screen.text[0]).toBe("ok");
    expect(screen.cells[0]![0]!.dim).toBe(false);
});

test("a code cut in two between writes is still read", () => {
    const screen = new Screen(12, 2);
    screen.write(`a${E}3`);
    screen.write("1mb\x1b");
    screen.write("[0mc");
    expect(screen.text[0]).toBe("abc");
    expect(screen.cells[0]![1]!.fg).toBe("var(--c1)");
});

test("wide characters take two cells and marks join the character before", () => {
    const screen = new Screen(6, 2);
    screen.write("a日bé");
    expect(screen.cells[0]!.map((cell) => cell.text)).toEqual(["a", "日", "", "b", "é", " "]);
    expect(screen.x).toBe(5);
});

test("the recording of mfy: its menu at rest, and where the tour ends", async () => {
    const lines = (await Bun.file(new URL("../../public/casts/mfetchy.cast", import.meta.url)).text()).trim().split("\n");
    const head = JSON.parse(lines[0]!) as { width: number; height: number; poster: number };
    const screen = new Screen(head.width, head.height);
    let rest: string[] = [];
    for (const line of lines.slice(1)) {
        const [at, , text] = JSON.parse(line) as [number, string, string];
        if (at > head.poster && !rest.length) rest = screen.text;
        screen.write(text);
    }
    expect(rest.join("\n")).toContain("♪ What do you want to do?");
    expect(rest.join("\n")).toContain("› Download my YouTube Music library");
    expect(screen.text.filter(Boolean).at(-1)).toBe("  ↑↓ move · enter open · esc back");
    // nothing left over from a code it did not understand
    expect(screen.text.join("\n")).not.toMatch(/\d;\d+[um]|\x1b/);
});
