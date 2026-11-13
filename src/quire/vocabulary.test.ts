// The typing table is held to what it says: every example, typed into an empty document a character
// at a time, writes the Markdown the table gives, and one undo straight after gives back what was
// typed. And every extra in it leaves standard Markdown meaning what CommonMark says it means.

import { expect, test } from "bun:test";
import { documentOf, paragraph, runsText, type Run } from "./document";
import { createHistory } from "./history";
import { caret, step, type Editor } from "./keys";
import { read } from "./read";
import { write } from "./write";
import { LINE_MARK, PAIRS, TYPING } from "./vocabulary";

function typeInto(text: string) {
    let editor: Editor = { state: { doc: documentOf([paragraph()]), selection: caret([0], 0) }, history: createHistory() };
    let time = 0;
    for (const char of text) editor = step(editor, char === "\n" ? { type: "key", key: "Enter" } : { type: "text", text: char }, (time += 10)).editor;
    return { editor, time };
}

test("every example in the typing table writes the Markdown the table says", () => {
    for (const each of TYPING) {
        if (!each.example) continue;
        const [typed, markdown] = each.example;
        expect({ typed, written: write(typeInto(typed).editor.state.doc) }).toEqual({ typed, written: markdown });
    }
});

test("one undo straight after a typed conversion gives back the characters as typed", () => {
    for (const each of TYPING) {
        if (!each.example || each.example[0].includes("\n")) continue;
        const [typed] = each.example;
        // the conversion happens on the sign that completes it; undo once there
        let { editor, time } = typeInto("");
        let converted = false;
        let sofar = "";
        for (const char of typed) {
            sofar += char;
            const result = step(editor, { type: "text", text: char }, (time += 10));
            editor = result.editor;
            if (result.outcome && "kind" in result.outcome && (result.outcome.kind === "shortcut" || result.outcome.kind === "symbol")) {
                converted = true;
                editor = step(editor, { type: "key", key: "z", mod: true }, (time += 10)).editor;
                break;
            }
        }
        // every example converts somewhere, and the undo gives back exactly what was typed up to there
        const text = runsText((editor.state.doc.blocks[0] as { runs: Run[] }).runs);
        expect({ typed, converted, text }).toEqual({ typed, converted: true, text: sofar });
    }
});

test("the line marks and pairs are built from the table", () => {
    expect(LINE_MARK.test("* ")).toBe(true);
    expect(LINE_MARK.test("12) ")).toBe(true);
    expect(LINE_MARK.test("[x] ")).toBe(true);
    expect(LINE_MARK.test("-# ")).toBe(false);
    expect(PAIRS.map((pair) => pair.mark)).toContain("spoiler");
    // standard Markdown's own meanings: no pair makes subscript, and none makes maths from dollars
    expect(PAIRS.map((pair) => pair.mark)).not.toContain("sub");
    expect(PAIRS.map((pair) => pair.mark)).not.toContain("math");
});

/** The text and marks a paragraph is read as, for comparing with what CommonMark says. */
const marks = (source: string) =>
    (read(source).blocks[0] as { runs: Run[] }).runs.map((run) => (run.kind === "text" ? (run.marks.length ? `[${run.marks.join("+")}:${run.text}]` : run.text) : `<${run.kind}>`)).join("");

test("standard Markdown reads as CommonMark says, whatever extras mdQuire takes", () => {
    const cases: [string, string][] = [
        // dollars are dollar signs
        ["it cost $5 and then $10", "it cost $5 and then $10"],
        ["$x$ is not maths", "$x$ is not maths"],
        // two underscores are bold, one is italic, inside a word they are letters
        ["__bold__ and _it_", "[bold:bold] and [italic:it]"],
        ["snake_case_name", "snake_case_name"],
        // GitHub reads one or two tildes as strikethrough
        ["~one~ ~~two~~", "[strike:one] [strike:two]"],
        // pipes with spaces are text, as in code written in prose
        ["a || b || c", "a || b || c"],
        ["a | b", "a | b"],
        // a dash and a hash with no space between is a paragraph's text, not a list or a heading
        ["-#nospace", "-#nospace"],
        // carets and equals signs alone are text
        ["2^10 and a = b", "2^10 and a = b"],
    ];
    for (const [source, expected] of cases) expect({ source, read: marks(source) }).toEqual({ source, read: expected });
    // a list, a heading and a quote keep their meaning
    expect(read("- item\n").blocks[0]!.kind).toBe("list");
    expect(read("# Title\n").blocks[0]!.kind).toBe("heading");
    expect(read("> quoted\n").blocks[0]!.kind).toBe("quote");
    // a line `-# ` inside a paragraph is part of it, as CommonMark has it: only a paragraph that starts so is subtext
    const joined = read("text\n-# more\n").blocks;
    expect(joined.length).toBe(1);
    expect((joined[0] as { subtext?: boolean }).subtext).toBeUndefined();
});

test("subtext and spoilers are read and written back byte for byte", () => {
    for (const source of ["-# small print\n", "Some ||hidden|| words.\n", "-# a **bold** small\n\nNext.\n", "a \\|\\|not hidden\\|\\| b\n"]) {
        const doc = read(source);
        expect(write(doc)).toBe(source);
        // and written from the model, without the source kept
        const fresh = { ...doc, blocks: doc.blocks.map((block) => ({ ...block, source: undefined })) };
        expect(write(read(write(fresh)))).toBe(write(fresh));
    }
    expect((read("-# small\n").blocks[0] as { subtext?: boolean }).subtext).toBe(true);
    expect(marks("Some ||hidden|| words.")).toBe("Some [spoiler:hidden] words.");
});
