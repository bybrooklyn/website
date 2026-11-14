// What Bullets and numbering is held to: a bulleted list is written with the sign chosen, a numbered
// list restarts at the number given (cut in two when that is part way down) and carries on the list
// before it, the cursor staying on its item, and what is written reads back as the same lists. Run
// with `bun test src/quire`.

import { expect, test } from "bun:test";
import { caret } from "./keys";
import { continuePrevious, listHere, markWith, restartAt } from "./numbering";
import { read } from "./read";
import { write } from "./write";

const state = (markdown: string, path: number[], offset = 0) => ({ doc: read(markdown), selection: caret(path, offset) });
const twice = (markdown: string) => write(read(markdown));

test("a bulleted list is written with the sign chosen, and a numbered list is left alone", () => {
    expect(write(markWith("*")(state("- one\n- two\n", [0, 1, 0])).doc)).toBe("* one\n* two\n");
    expect(write(markWith("+")(state("- [ ] task\n", [0, 0, 0])).doc)).toBe("+ [ ] task\n");
    expect(write(markWith("*")(state("1. one\n", [0, 0, 0])).doc)).toBe("1. one\n");
    expect(listHere(read("Term\n: said\n"), [0, 0, 0])).toBeUndefined();
});

test("numbering restarts at the first item by the list's own start, and part way down by cutting the list there", () => {
    expect(write(restartAt(5)(state("1. a\n2. b\n", [0, 0, 0])).doc)).toBe("5. a\n6. b\n");
    const cut = restartAt(1)(state("1. a\n2. b\n3. c\n", [0, 2, 0], 1));
    const written = write(cut.doc);
    expect(written).toBe("1. a\n2. b\n\n1) c\n");
    expect(twice(written)).toBe(written);
    expect(read(written).blocks.map((block) => block.kind === "list" && block.start)).toEqual([1, 1]);
    expect(cut.selection.focus).toEqual({ path: [1, 0, 0], offset: 1 });
});

test("continuing the list before joins the two when they stand together, and carries the numbers on when they do not", () => {
    const joined = continuePrevious(state("1. a\n2. b\n\n1) c\n", [1, 0, 0]));
    expect(write(joined.doc)).toBe("1. a\n2. b\n3. c\n");
    expect(joined.selection.focus.path).toEqual([0, 2, 0]);
    expect(write(continuePrevious(state("1. a\n2. b\n\nBetween.\n\n1. c\n", [2, 0, 0])).doc)).toBe("1. a\n2. b\n\nBetween.\n\n3. c\n");
    expect(write(continuePrevious(state("- a\n\n* b\n", [1, 0, 0])).doc)).toBe("- a\n- b\n");
    // a bulleted list does not join a numbered one
    expect(write(continuePrevious(state("1. a\n\n- b\n", [1, 0, 0])).doc)).toBe("1. a\n\n- b\n");
});
