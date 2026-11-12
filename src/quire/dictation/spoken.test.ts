// What spoken punctuation and commands are held to do: marks written and spaced, breaks only where
// they are meant, commands only when they are the whole phrase, and nothing doubled when the model
// has punctuated already.

import { describe, expect, test } from "bun:test";
import { interpret, plain, startsSentence, type Step } from "./spoken";

/** The text a phrase writes, with a break shown as a bar and a command in brackets, taking back what is erased. */
const written = (phrase: string, before = "", commands = true): string => {
    let out = before;
    for (const step of interpret(phrase, { before, commands })) {
        if (step.kind === "text") out = (step.erase ? out.slice(0, -step.erase) : out) + step.text;
        else if (step.kind === "line") out += "|";
        else if (step.kind === "paragraph") out += "||";
        else out += `[${step.command}]`;
    }
    return out;
};
const steps = (phrase: string, before = "", commands = true): Step[] => interpret(phrase, { before, commands });

describe("spoken marks", () => {
    test("comma is a comma with no space before it", () => {
        expect(written("Hello comma world")).toBe("Hello, world");
    });
    test("period and full stop end a sentence and the next word is a capital", () => {
        expect(written("I agree period the next one")).toBe("I agree. The next one");
        expect(written("I agree full stop and then")).toBe("I agree. And then");
    });
    test("question mark, exclamation mark and exclamation point", () => {
        expect(written("Are you there question mark yes")).toBe("Are you there? Yes");
        expect(written("Wow exclamation mark")).toBe("Wow!");
        expect(written("Wow exclamation point nice")).toBe("Wow! Nice");
    });
    test("colon and semicolon stay against the word before and keep the case after", () => {
        expect(written("Note colon this matters")).toBe("Note: this matters");
        expect(written("one semicolon two")).toBe("One; two");
    });
    test("dash has a space on both sides", () => {
        expect(written("one dash two")).toBe("One - two");
    });
    test("open and close quote sit against the words they hold", () => {
        expect(written("she said open quote hello there close quote and left")).toBe('She said "hello there" and left');
    });
    test("open and close bracket sit against the words they hold", () => {
        expect(written("it works open bracket mostly close bracket")).toBe("It works (mostly)");
        expect(written("see open parenthesis here close parenthesis")).toBe("See (here)");
    });
    test("a mark can end the phrase and the next phrase carries on after it", () => {
        expect(written("see you soon period")).toBe("See you soon.");
        expect(written("Then we left", "See you soon.")).toBe("See you soon. Then we left");
    });
    test("a mark said alone is written against the text before the cursor", () => {
        expect(written("comma", "Hello")).toBe("Hello,");
        expect(written("question mark", "Is it")).toBe("Is it?");
    });
    test("the words are matched whatever the case and whatever punctuation the model gave them", () => {
        expect(written("Hello, Comma. world")).toBe("Hello, world");
        expect(written("Hello COMMA world")).toBe("Hello, world");
    });
});

describe("the model has punctuated already", () => {
    test("a spoken comma after the model's comma is not doubled", () => {
        expect(written("Hello, comma world")).toBe("Hello, world");
        expect(written("Hello comma, world")).toBe("Hello, world");
    });
    test("a spoken period after the model's period is not doubled", () => {
        expect(written("I agree. Period. Next")).toBe("I agree. Next");
    });
    test("a spoken mark replaces a different one the model wrote", () => {
        expect(written("I agree, period")).toBe("I agree.");
        expect(written("Really. Question mark")).toBe("Really?");
    });
    test("a mark already at the end of the earlier phrase is found there", () => {
        expect(written("comma then more", "Hello,")).toBe("Hello, then more");
        expect(steps("period", "Hello.")).toEqual([]);
    });
    test("a replaced mark in the earlier phrase is erased", () => {
        expect(steps("period", "Hello,")).toEqual([{ kind: "text", text: ".", erase: 1 }]);
    });
});

describe("a mark word that is really a word", () => {
    test("after an article it is written out", () => {
        expect(written("the period of the orbit")).toBe("The period of the orbit");
        expect(written("a comma splice")).toBe("A comma splice");
    });
});

describe("breaks", () => {
    test("enter and new line alone are a new line", () => {
        expect(steps("Enter.")).toEqual([{ kind: "line" }]);
        expect(steps("new line")).toEqual([{ kind: "line" }]);
        expect(steps("New line.")).toEqual([{ kind: "line" }]);
    });
    test("enter at the end of a sentence is a new line", () => {
        expect(written("that is all enter")).toBe("That is all|");
        expect(written("that is all. Enter.")).toBe("That is all.|");
    });
    test("enter inside a sentence is a word", () => {
        expect(written("press enter to continue")).toBe("Press enter to continue");
        expect(written("hit the new line key")).toBe("Hit the new line key");
    });
    test("new paragraph is a paragraph break wherever it is said", () => {
        expect(steps("new paragraph")).toEqual([{ kind: "paragraph" }]);
        expect(written("end of it new paragraph and then more")).toBe("End of it||And then more");
    });
    test("what follows a break begins with a capital and no space", () => {
        expect(written("one enter two", "")).toBe("One enter two");
        expect(steps("first line. New line. second line")[2]).toEqual({ kind: "text", text: "Second line" });
    });
});

describe("commands", () => {
    test.each([
        ["heading", "heading1"],
        ["Heading.", "heading1"],
        ["heading two", "heading2"],
        ["heading 3", "heading3"],
        ["bullet", "bullet"],
        ["Bullet point.", "bullet"],
        ["numbered list", "numbered"],
        ["undo that", "undo"],
        ["Undo that.", "undo"],
        ["delete that", "delete"],
        ["scratch that", "delete"],
        ["stop dictation", "stop"],
        ["Stop dictation.", "stop"],
    ])("%s is the command %s", (phrase, command) => {
        expect(steps(phrase)).toEqual([{ kind: "command", command: command as never }]);
    });
    test("a command is only a command as the whole phrase", () => {
        expect(written("the heading of the page")).toBe("The heading of the page");
        expect(written("a bullet hit the wall")).toBe("A bullet hit the wall");
        expect(written("we should undo that change")).toBe("We should undo that change");
    });
    test("stop dictation may close a phrase", () => {
        expect(written("that is everything stop dictation")).toBe("That is everything[stop]");
        expect(steps("stop dictation", "text")).toEqual([{ kind: "command", command: "stop" }]);
    });
});

describe("spacing and capitals", () => {
    test("a phrase after text gets a space, and none at the start", () => {
        expect(steps("and the next", "First part,")).toEqual([{ kind: "text", text: " and the next" }]);
        expect(steps("hello there", "")).toEqual([{ kind: "text", text: "Hello there" }]);
    });
    test("no space after an opening bracket or at the start of a line", () => {
        expect(steps("inside", "(")).toEqual([{ kind: "text", text: "inside" }]);
        expect(steps("inside", "line one\n")).toEqual([{ kind: "text", text: "inside" }]);
    });
    test("a phrase that begins a sentence is capitalised, and one that continues is not", () => {
        expect(steps("and then we left", "We came in.")).toEqual([{ kind: "text", text: " And then we left" }]);
        expect(steps("And then we left", "We came in,")).toEqual([{ kind: "text", text: " and then we left" }]);
    });
    test("a name or I keeps its capital in the middle of a sentence", () => {
        expect(steps("Brooklyn is far", "We went to")).toEqual([{ kind: "text", text: " Brooklyn is far" }]);
        expect(steps("I think so", "Well,")).toEqual([{ kind: "text", text: " I think so" }]);
    });
    test("after a closing quote a sentence still ends", () => {
        expect(startsSentence('He said "go."')).toBe(true);
        expect(startsSentence("He said go")).toBe(false);
        expect(startsSentence("")).toBe(true);
    });
});

describe("with spoken commands off", () => {
    test("every word is written as it was heard", () => {
        expect(written("Hello comma world period", "", false)).toBe("Hello comma world period");
        expect(steps("new paragraph", "", false)).toEqual([{ kind: "text", text: "New paragraph" }]);
        expect(steps("undo that", "", false)).toEqual([{ kind: "text", text: "Undo that" }]);
    });
});

test("plain lowercases and drops punctuation", () => {
    expect(plain("  Undo,  THAT! ")).toBe("undo that");
});
