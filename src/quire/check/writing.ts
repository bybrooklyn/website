// Her writing rules, flagged as she types: the same ones the site's own linter holds her pages to
// (scripts/lint.ts, TELLS and FRAMING), and the rest of the list in her prose rules of what reads as
// written by a model. mdQuire may not import from outside its folder, so the lists are copied here;
// a change to one belongs in the other. Each rule says why in a sentence, and where the fix is
// mechanical (a dash to a full stop, an emoji taken out) it is offered.

import { replaceWith, type Hit, type Rule, type Unit } from "./engine";

/** The words from the keep-out list in scripts/lint.ts. */
export const KEEP_OUT = /\b(journey|passion|crafted|delightful|seamless(ly)?|leverag(e|ing)|robust|elevate|effortless(ly)?|game.changer)\b/gi;

/** Hedges and filler: words that soften a sentence without saying anything. */
const FILLER = /\b(basically|essentially|literally|honestly|needless to say|it goes without saying|at the end of the day|in order to)\b/gi;

/** The unit's text with quiet letters (code, addresses) blanked, so that patterns never match inside them. */
export function spoken(unit: Unit): string {
    const { text, quiet } = unit.read;
    let out = "";
    for (let index = 0; index < text.length; index++) out += quiet[index] ? " " : text[index];
    return out;
}

/** Every match of a pattern in the spoken text, as hits. */
function matches(unit: Unit, pattern: RegExp, hit: (match: RegExpMatchArray, text: string) => Hit | undefined): Hit[] {
    if (unit.code) return [];
    const text = spoken(unit);
    const out: Hit[] = [];
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
        const one = hit(match, text);
        if (one) out.push(one);
    }
    return out;
}

/** A full stop in place of a mark, the next word given its capital: "a; b" to "a. B". */
function stopFix(match: RegExpMatchArray, text: string, label = "Use a full stop"): Hit["fixes"] {
    const end = match.index! + match[0].length;
    const next = text[end];
    if (!next || !/\p{Ll}/u.test(next)) return [replaceWith(label, ". ")];
    // the fix covers the next letter too, so it is written again as a capital
    return [{ label, edit: (doc, range) => replaceWith(label, `. ${next.toUpperCase()}`).edit(doc, { start: range.start, end: { ...range.end, offset: range.end.offset + 1 } }) }];
}

const dash: Rule = {
    id: "writing-dash",
    kind: "prose",
    severity: "mistake",
    label: "A dash used as punctuation",
    why: "Her writing uses a full stop or a comma there; a dash used for effect reads as written by a model.",
    on: true,
    unit(unit) {
        return matches(unit, /\s*[—–]\s*|\s+--?\s+/g, (match, text) => {
            const from = match.index!;
            const to = from + match[0].length;
            // a dash between two numbers is a range of them, and not punctuation
            if (/\d/.test(text[from - 1] ?? "") && /\d/.test(text[to] ?? "")) return undefined;
            if (from === 0 || to === text.length) return undefined;
            return { from, to, message: "A dash used as punctuation.", fixes: [...stopFix(match, text)!, replaceWith("Use a comma", ", ")] };
        });
    },
};

const emoji: Rule = {
    id: "writing-emoji",
    kind: "prose",
    severity: "mistake",
    label: "Emoji",
    why: "Emoji are for chat; her published pages have none.",
    on: true,
    unit(unit) {
        return matches(unit, /\s?(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\u{FE0F}?\u{20E3})(?:[\u{FE0E}\u{FE0F}\u{20E3}\u{E0020}-\u{E007F}]|\p{Emoji_Modifier}|\u{200D}\p{Extended_Pictographic})*)+/gu, (match) => ({ from: match.index!, to: match.index! + match[0].length, message: "An emoji.", fixes: [replaceWith("Take it out", "")] }));
    },
};

const keepOut: Rule = {
    id: "writing-keep-out",
    kind: "prose",
    severity: "mistake",
    label: "Words from the keep-out list",
    why: "Words like journey, passion and seamless are the ones she has struck out of text written for her as sounding like a model.",
    on: true,
    unit(unit) {
        return matches(unit, KEEP_OUT, (match) => ({ from: match.index!, to: match.index! + match[0].length, message: `"${match[0]}" is on the keep-out list.` }));
    },
};

const notJust: Rule = {
    id: "writing-not-just",
    kind: "prose",
    severity: "mistake",
    label: "A \"not just X\" framing",
    why: "\"Not just\" and \"more than just\" build up something to knock down; she says the thing itself.",
    on: true,
    unit(unit) {
        return matches(unit, /\b(not just|not only|isn't just|more than just)\b/gi, (match) => ({ from: match.index!, to: match.index! + match[0].length, message: "A \"not just X\" framing." }));
    },
};

const notBut: Rule = {
    id: "writing-not-but",
    kind: "prose",
    severity: "mistake",
    label: "A \"not X, but Y\" framing",
    why: "Saying what something is not before what it is reads as a model's rhythm; say what it is.",
    on: true,
    unit(unit) {
        return matches(unit, /\b(?:is|was|are|were|it's|isn't|wasn't)\s+not\s+[^.,;!?]{1,40},\s+but\s+/gi, (match) => ({ from: match.index!, to: match.index! + match[0].length, message: "A \"not X, but Y\" framing." }));
    },
};

const semicolon: Rule = {
    id: "writing-semicolon",
    kind: "prose",
    severity: "advice",
    label: "Semicolons",
    why: "Her own sentences end with a full stop where a semicolon might go.",
    on: true,
    unit(unit) {
        return matches(unit, /\s*;\s+/g, (match, text) => {
            const at = match.index!;
            // semicolons that separate the items of a series are left alone: a sentence with two, or a short piece either side
            const sentence = unit.sentences.find((span) => span.from <= at && span.to >= at);
            const before = text.slice(sentence?.from ?? 0, at);
            const after = text.slice(at + match[0].length, sentence?.to ?? text.length);
            const count = (piece: string) => piece.split(/\s+/).filter(Boolean).length;
            if (/;/.test(before) || /;/.test(after) || count(before.split(/[,:]/).at(-1)!) < 5 || count(after.split(/[,:]/)[0]!) < 5) return undefined;
            return { from: at, to: at + match[0].length, message: "A semicolon, where she would end the sentence.", fixes: stopFix(match, text) };
        });
    },
};

const filler: Rule = {
    id: "writing-filler",
    kind: "prose",
    severity: "advice",
    label: "Hedges and filler",
    why: "Hedging and throat-clearing soften a sentence and say nothing; cut to the fact.",
    on: true,
    unit(unit) {
        return matches(unit, FILLER, (match) => ({ from: match.index!, to: match.index! + match[0].length, message: `"${match[0]}" says nothing here.`, fixes: /^in order to$/i.test(match[0]) ? [replaceWith("Use \"to\"", match[0][0] === "I" ? "To" : "to")] : [] }));
    },
};

/** Her writing rules. */
export const WRITING: Rule[] = [dash, emoji, keepOut, notJust, notBut, semicolon, filler];
