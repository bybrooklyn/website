// Spoken punctuation and commands for dictation: what a settled phrase from the recognizer becomes
// when it is written at the cursor. "comma" is a comma, "new line" is a new line, "undo that" is not
// written at all. Pure, with the words in tables, so that what is understood is easy to read and to
// change; spoken.test.ts holds what is meant to be true.
//
//   interpret("Hello comma world period", { before: "", commands: true })
//     gives text steps: "Hello", ",", " world", "." with the spacing and capitals put right.
//
// The Parakeet recognizers (v3) already write punctuation and capitals of their own (Moonshine writes
// none). A spoken mark is therefore not added on top of one the model wrote: it replaces it, or
// finds it already there.

/** What a spoken command does. The headings and the lists change the block being written; the rest act on the dictation. */
export type Command = "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "undo" | "delete" | "stop";

/** One thing to do at the cursor, in order. `erase` takes back that many characters before the cursor first (a comma the model wrote where a period was said). */
export type Step = { kind: "text"; text: string; erase?: number } | { kind: "line" } | { kind: "paragraph" } | { kind: "command"; command: Command };

/** What the phrase is written after: the text of the block before the cursor, and whether spoken commands are on. */
export interface Context {
    before: string;
    commands: boolean;
}

/** How a spoken mark sits in the text: against the word before it, against the word after it, or with a space on both sides. */
type Spacing = "attach" | "open" | "spaced";

interface Mark {
    mark: string;
    spacing: Spacing;
    /** The next word begins a sentence. */
    capital?: boolean;
}

/** The spoken marks, by the words that say them. */
export const MARKS: Record<string, Mark> = {
    comma: { mark: ",", spacing: "attach" },
    period: { mark: ".", spacing: "attach", capital: true },
    "full stop": { mark: ".", spacing: "attach", capital: true },
    "question mark": { mark: "?", spacing: "attach", capital: true },
    "exclamation mark": { mark: "!", spacing: "attach", capital: true },
    "exclamation point": { mark: "!", spacing: "attach", capital: true },
    colon: { mark: ":", spacing: "attach" },
    semicolon: { mark: ";", spacing: "attach" },
    dash: { mark: "-", spacing: "spaced" },
    "open quote": { mark: '"', spacing: "open" },
    "close quote": { mark: '"', spacing: "attach" },
    "end quote": { mark: '"', spacing: "attach" },
    "open bracket": { mark: "(", spacing: "open" },
    "open parenthesis": { mark: "(", spacing: "open" },
    "close bracket": { mark: ")", spacing: "attach" },
    "close parenthesis": { mark: ")", spacing: "attach" },
};

/** Words after which a mark word is an ordinary noun ("the period of the orbit", "a comma splice"). */
const ARTICLES = new Set(["the", "a", "an", "this", "that", "my", "your", "his", "her", "its", "our", "their", "no", "each", "every"]);

/** The words that mean a break in the text. */
const BREAKS: Record<string, "line" | "paragraph"> = { "new line": "line", enter: "line", "new paragraph": "paragraph" };
/** These two are only a command said as a phrase by itself or at the end of a sentence: "press enter to continue" is not one. */
const GUARDED = new Set(["new line", "enter"]);

/** Phrases that are a command when they are the whole phrase. */
const ALONE: Record<string, Command> = {
    heading: "heading1",
    "heading one": "heading1",
    "heading 1": "heading1",
    "heading two": "heading2",
    "heading 2": "heading2",
    "heading three": "heading3",
    "heading 3": "heading3",
    bullet: "bullet",
    "bullet point": "bullet",
    "numbered list": "numbered",
    "number list": "numbered",
    "undo that": "undo",
    "delete that": "delete",
    "scratch that": "delete",
    "stop dictation": "stop",
    "stop listening": "stop",
};

/** Words a sentence may begin with that are never names: lowercased when a phrase continues a sentence the one before it left open. */
const PLAIN = new Set(["and", "but", "or", "so", "then", "the", "a", "an", "to", "of", "in", "on", "at", "for", "with", "that", "which", "because", "if", "when", "as", "it", "we", "he", "she", "they", "you", "is", "are", "was", "were", "not", "also", "yet", "while", "from", "by"]);

/** A phrase's words, lowercased, with the punctuation gone, as the tables above are written. */
export function plain(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

interface Token {
    lead: string;
    core: string;
    trail: string;
}

const tokens = (phrase: string): Token[] =>
    phrase
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => {
            const found = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(raw)!;
            return { lead: found[1]!, core: found[2]!, trail: found[3]! };
        });

type Atom = { kind: "word"; text: string } | ({ kind: "mark" } & Mark) | { kind: "line" } | { kind: "paragraph" } | { kind: "command"; command: Command };

/** Reads a phrase into words, marks, breaks and commands. */
function atoms(phrase: string, commands: boolean): Atom[] {
    const all = tokens(phrase);
    const word = (token: Token): Atom => ({ kind: "word", text: token.lead + token.core + token.trail });
    if (!commands) return all.map(word);
    const whole = plain(phrase);
    // A command is a phrase by itself. "stop dictation" at the end of a longer phrase is not one: "I told them
    // to stop listening" is a sentence, and its last two words were once dropped and dictation switched off.
    if (ALONE[whole]) return [{ kind: "command", command: ALONE[whole]! }];
    const out: Atom[] = [];
    for (let at = 0; at < all.length; at++) {
        let size = 0;
        for (const tried of [3, 2, 1]) {
            if (at + tried > all.length) continue;
            const run = all.slice(at, at + tried);
            // the words of a spoken phrase run together: only the last may carry punctuation
            if (run.slice(0, -1).some((token) => token.trail) || run.slice(1).some((token) => token.lead)) continue;
            const said = run.map((token) => token.core.toLowerCase()).join(" ");
            const last = run[run.length - 1]!;
            const mark = MARKS[said];
            const before = all[at - 1];
            if (mark && !(before && ARTICLES.has(before.core.toLowerCase()) && !before.trail)) {
                out.push({ kind: "mark", ...mark });
                size = tried;
                break;
            }
            const kind = BREAKS[said];
            if (kind && (!GUARDED.has(said) || at + tried === all.length || /[.!?]/.test(last.trail))) {
                out.push({ kind });
                size = tried;
                break;
            }
        }
        if (size) at += size - 1;
        else out.push(word(all[at]!));
    }
    return out;
}

const CLAUSE = /[,.;:!?]$/;
const capitalise = (word: string) => word.replace(/\p{L}/u, (letter) => letter.toUpperCase());
const lowercase = (word: string) => word.replace(/\p{L}/u, (letter) => letter.toLowerCase());

/** True when the text before the cursor ends a sentence, or there is none, so that the next word begins one. */
export function startsSentence(before: string): boolean {
    const trimmed = before.replace(/[\s"'”’)\]]+$/u, "");
    return trimmed === "" || /[.!?]$/.test(trimmed);
}

/**
 * What a settled phrase becomes at the cursor: text steps with the spacing and capitals put right,
 * breaks and commands. With `commands` off every word is written as the model heard it.
 */
export function interpret(phrase: string, context: Context): Step[] {
    const steps: Step[] = [];
    let segment = "";
    let erase = 0;
    // what stands before the next thing written, for the spacing and the capitals
    let tail = context.before;
    let capital = startsSentence(context.before);
    let tight = false;
    let first = true;

    const flush = () => {
        if (segment || erase) steps.push(erase ? { kind: "text", text: segment, erase } : { kind: "text", text: segment });
        segment = "";
        erase = 0;
    };
    /** Takes back the last character written, in this phrase or in the text before it. */
    const takeBack = () => {
        if (segment) segment = segment.slice(0, -1);
        else erase++;
        tail = tail.slice(0, -1);
    };
    const write = (text: string) => {
        segment += text;
        tail += text;
    };
    const space = () => tail !== "" && !tight && !/[\s(\[“‘]$/.test(tail);

    for (const atom of atoms(phrase, context.commands)) {
        if (atom.kind === "command") {
            flush();
            steps.push(atom);
        } else if (atom.kind === "line" || atom.kind === "paragraph") {
            flush();
            steps.push({ kind: atom.kind });
            tail = "";
            capital = true;
            tight = false;
            first = false;
        } else if (atom.kind === "word") {
            let word = atom.text;
            if (capital) word = capitalise(word);
            else if (first && tail !== "" && PLAIN.has(word.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase())) word = lowercase(word);
            write((space() ? " " : "") + word);
            capital = false;
            tight = false;
            first = false;
        } else {
            first = false;
            if (atom.spacing === "attach") {
                // the model may have written the mark already, or another in its place
                if (CLAUSE.test(tail) && CLAUSE.test(atom.mark)) {
                    if (!tail.endsWith(atom.mark)) takeBack();
                    else {
                        capital = capital || !!atom.capital;
                        continue;
                    }
                }
                write(atom.mark);
                tight = false;
            } else if (atom.spacing === "open") {
                write((space() ? " " : "") + atom.mark);
                tight = true;
            } else {
                write((tail !== "" && !/\s$/.test(tail) ? " " : "") + atom.mark + " ");
                tight = true;
            }
            // a quote or a bracket leaves the capital as it was; any other mark settles it
            if (atom.capital) capital = true;
            else if (!/^["()]$/.test(atom.mark)) capital = false;
        }
    }
    flush();
    return steps;
}
