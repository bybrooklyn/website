// What typing the further Markdown is held to: each typed shortcut makes its kind, with the one undo
// that gives back the characters typed; typed signs become their characters only where the switch
// allows and never in code or maths, and one Backspace straight after puts the characters back; and
// Enter in a definition list goes from definition to term as a writer expects.

import { expect, test } from "bun:test";
import { documentOf, paragraph, textAt, type Document, type Selection } from "./document";
import { createHistory } from "./history";
import { caret, step, type Editor, type Input, type TypingOptions } from "./keys";
import { read } from "./read";
import { write } from "./write";

/** An editor on some Markdown with the cursor at a place, typing as the surface does, signs on unless asked otherwise. */
function editor(source: string, path: number[] = [0], offset = 0, options: TypingOptions = { symbols: true }) {
    let current: Editor = { state: { doc: source === "" ? documentOf([paragraph()]) : read(source, { mdx: /^import|^</m.test(source) }), selection: caret(path, offset) }, history: createHistory() };
    let time = 0;
    const send = (input: Input) => {
        const result = step(current, input, time, options);
        current = result.editor;
        time += 10;
        return result.outcome;
    };
    return {
        type(text: string) {
            for (const value of text) send({ type: "text", text: value });
        },
        key(key: string, modifiers: { shift?: boolean; mod?: boolean; alt?: boolean } = {}) {
            return send({ type: "key", key, ...modifiers });
        },
        select(selection: Selection) {
            current = { ...current, state: { doc: current.state.doc, selection } };
        },
        get markdown() {
            return write(current.state.doc);
        },
        get cursor() {
            return current.state.selection.focus;
        },
        get doc() {
            return current.state.doc;
        },
        undo: () => send({ type: "key", key: "z", mod: true }),
    };
}

/** The plain text of the first block, as the writer sees it before escaping. */
const text = (doc: Document) => textAt(doc, [0]);

// ---- typed signs ----

test("each typed pair becomes its character, and what is saved is that character", () => {
    const e = editor("");
    e.type("a -> b <- c => d != e <= f >= g");
    expect(e.markdown).toBe("a → b ← c ⇒ d ≠ e ≤ f ≥ g\n");
    expect(e.cursor.offset).toBe("a → b ← c ⇒ d ≠ e ≤ f ≥ g".length);
});

test("one Backspace straight after puts the two characters back, and so does one undo", () => {
    const e = editor("");
    e.type("go ->");
    expect(e.markdown).toBe("go →\n");
    e.key("Backspace");
    expect(e.markdown).toBe("go ->\n");
    expect(e.cursor.offset).toBe(5);
    // a second Backspace deletes as usual
    e.key("Backspace");
    expect(e.markdown).toBe("go -\n");
    const f = editor("");
    f.type("x != y");
    expect(f.markdown).toBe("x ≠ y\n");
    f.type(" ");
    // once something else is typed, Backspace is an ordinary Backspace again
    f.key("Backspace");
    f.key("Backspace");
    expect(f.markdown).toBe("x ≠\n");
    const g = editor("");
    g.type("a ->");
    g.undo();
    expect(g.markdown).toBe("a ->\n");
});

test("signs are left as typed in code blocks, code spans, maths, an open code span, and when the switch is off", () => {
    const code = editor("```\nx\n```\n", [0], 1);
    code.type(" -> y");
    expect(code.markdown).toBe("```\nx -> y\n```\n");
    const span = editor("A `code` b\n", [0], 4);
    span.type("->");
    expect(span.markdown).toBe("A `co->de` b\n");
    const open = editor("");
    open.type("`a -> b`");
    expect(open.markdown).toBe("`a -> b`\n");
    const maths = editor("");
    maths.type("$a -> b$");
    expect(maths.markdown).toBe("$a -> b$\n");
    const off = editor("", [0], 0, { symbols: false });
    off.type("a -> b != c");
    expect(off.markdown).toBe("a -> b != c\n");
});

test("no dash is made, and == and === are saved as typed", () => {
    const e = editor("");
    e.type("a -- b == c === d");
    expect(e.markdown).toBe("a -- b == c === d\n");
});

test("a known emoji shortcode becomes the emoji as its colon is typed, an unknown one stays, and Backspace gives the text back", () => {
    const e = editor("");
    e.type("well done :tada:");
    expect(e.doc.blocks[0]).toMatchObject({ kind: "paragraph", runs: [{ kind: "text", text: "well done " }, { kind: "emoji", name: "tada" }] });
    expect(e.markdown).toBe("well done :tada:\n");
    e.key("Backspace");
    expect(e.doc.blocks[0]).toMatchObject({ runs: [{ kind: "text", text: "well done :tada:" }] });
    const unknown = editor("");
    unknown.type(":nothing: 12:30:");
    expect(unknown.doc.blocks[0]).toMatchObject({ runs: [{ kind: "text", text: ":nothing: 12:30:" }] });
});

// ---- marks ----

test("==marked==, ^sup^, ~sub~ and $maths$ are made as their closing mark is typed, and undo gives the characters back", () => {
    const cases: [string, string][] = [
        ["==hi==", "==hi==\n"],
        ["E=mc^2^", "E=mc<sup>2</sup>\n"],
        ["H~2~", "H<sub>2</sub>\n"],
        ["area $\\pi r^2$", "area $\\pi r^2$\n"],
    ];
    for (const [typed, written] of cases) {
        const e = editor("");
        e.type(typed);
        expect({ typed, written: e.markdown }).toEqual({ typed, written });
        e.undo();
        expect({ typed, back: text(e.doc) }).toEqual({ typed, back: typed });
    }
    const maths = editor("");
    maths.type("$x$");
    expect(maths.doc.blocks[0]).toMatchObject({ runs: [{ kind: "text", text: "x", marks: ["math"] }] });
    // typing on after maths is outside it
    maths.type(" then");
    expect(maths.markdown).toBe("$x$ then\n");
    // money is not maths
    const money = editor("");
    money.type("from $5 to $10");
    expect(money.markdown).toBe("from $5 to $10\n");
});

test("Ctrl with full stop, comma and Shift+H mark superscript, subscript and marked text", () => {
    const e = editor("x2 H2O hi\n");
    e.select({ anchor: { path: [0], offset: 1 }, focus: { path: [0], offset: 2 } });
    e.key(".", { mod: true });
    e.select({ anchor: { path: [0], offset: 4 }, focus: { path: [0], offset: 5 } });
    e.key(",", { mod: true });
    e.select({ anchor: { path: [0], offset: 7 }, focus: { path: [0], offset: 9 } });
    e.key("h", { mod: true, shift: true });
    expect(e.markdown).toBe("x<sup>2</sup> H<sub>2</sub>O ==hi==\n");
});

// ---- blocks ----

test("[!NOTE] and a space makes a callout, and one undo gives the characters back", () => {
    const e = editor("");
    e.type("[!tip] Use it");
    expect(e.markdown).toBe("> [!TIP]\n> Use it\n");
    const f = editor("");
    f.type("[!warning] ");
    f.undo();
    expect(text(f.doc)).toBe("[!warning] ");
});

test("a colon and a space under a line makes that line a term and this its definition, and Enter goes on to the next", () => {
    const e = editor("Apple\n", [0], 5);
    e.key("Enter");
    e.type(": A fruit.");
    expect(e.markdown).toBe("Apple\n: A fruit.\n");
    e.key("Enter");
    e.type("A company.");
    expect(e.markdown).toBe("Apple\n: A fruit.\n: A company.\n");
    // Enter on an empty definition starts the next term
    e.key("Enter");
    e.key("Enter");
    e.type("Pear");
    e.key("Enter");
    e.type("Another.");
    expect(e.markdown).toBe("Apple\n: A fruit.\n: A company.\nPear\n: Another.\n");
    // and Enter on an empty term with nothing under it leaves the list
    e.key("Enter");
    e.key("Enter");
    e.key("Enter");
    e.type("After.");
    expect(e.markdown).toBe("Apple\n: A fruit.\n: A company.\nPear\n: Another.\n\nAfter.\n");
});

test("Enter on an empty last line leaves a callout, a folding section or a quote, and a box typed inside one is a box of its own", () => {
    const e = editor("");
    e.type("[!note] Inside");
    e.key("Enter");
    e.key("Enter");
    e.type("Outside");
    expect(e.markdown).toBe("> [!NOTE]\n> Inside\n\nOutside\n");
    const f = editor("> [!TIP]\n> One\n", [0, 0], 3);
    f.key("Enter");
    f.type("<details>");
    f.type("Folded");
    expect(f.doc.blocks[0]).toMatchObject({ kind: "quote", callout: "TIP" });
    expect(f.markdown).toBe("> [!TIP]\n> One\n>\n> <details>\n> <summary></summary>\n>\n> Folded\n>\n> </details>\n");
});

test("[x] typed in a checklist item that already has a box ticks it", () => {
    const e = editor("- [ ] one\n", [0, 0, 0], 3);
    e.key("Enter");
    e.type("[x] two");
    expect(e.markdown).toBe("- [ ] one\n- [x] two\n");
});

test("$$ on an empty line starts a block of maths, and <details> a folding section", () => {
    const e = editor("");
    e.type("$$");
    e.type("x^2");
    expect(e.markdown).toBe("$$\nx^2\n$$\n");
    const f = editor("");
    f.type("<details>");
    f.type("Hidden");
    expect(f.markdown).toBe("<details>\n<summary></summary>\n\nHidden\n\n</details>\n");
});

test("typing on a component's card starts a paragraph after it, never inside its tag", () => {
    const e = editor('import Figure from "../../components/Figure.astro";\n\n<Figure src="/a.webp" alt="A" width={1} height={1} />\n', [1], 0);
    e.type("After");
    expect(e.markdown).toBe('import Figure from "../../components/Figure.astro";\n\n<Figure src="/a.webp" alt="A" width={1} height={1} />\n\nAfter\n');
});
