// Prose: rules a person can read, written for mdQuire from scratch. A word written twice running,
// sentences and paragraphs longer than she likes (she sets how long), the passive (off at the start,
// since no simple rule catches it without false alarms), weak openings and stock phrases, adverbs
// piled up, a word spelled two ways in one document, quotation marks and apostrophes of two kinds,
// and a sentence that starts with a small letter. `readability` gives the reading-ease score and the
// average sentence length the list shows at its head.

import type { Document } from "../document";
import { replaceWith, type Finding, type Hit, type Rule, type Unit } from "./engine";
import { readingEase, syllables } from "./text";
import { spoken } from "./writing";

/** A finding at one place in a unit, for document rules. */
const at = (rule: Rule, unit: Unit, from: number, to: number, message: string, fixes: Finding["fixes"] = []): Finding => ({ rule: rule.id, kind: rule.kind, severity: rule.severity, range: { start: { path: unit.path, offset: from }, end: { path: unit.path, offset: to } }, message, fixes });

/** Words of a unit's sentence, as lower case. */
const prose = (unit: Unit) => !unit.code && !!unit.runs;

// ---- a word twice ----

/** Words that are right written twice: "had had", "that that". */
const TWICE = new Set(["had", "that", "is", "do", "bye", "so", "very", "ha", "no", "go", "really"]);

const repeated: Rule = {
    id: "prose-repeat",
    kind: "prose",
    severity: "mistake",
    label: "A word written twice",
    why: "The same word twice in a row is nearly always a slip made while changing a sentence.",
    on: true,
    unit(unit) {
        if (!prose(unit)) return [];
        const out: Hit[] = [];
        const text = unit.read.text;
        for (let index = 1; index < unit.words.length; index++) {
            const one = unit.words[index - 1]!;
            const two = unit.words[index]!;
            const between = text.slice(one.to, two.from);
            if (!/^[ \t]+$/.test(between) || one.word.toLowerCase() !== two.word.toLowerCase() || TWICE.has(two.word.toLowerCase()) || /\d/.test(two.word)) continue;
            out.push({ from: one.to, to: two.to, message: `"${two.word}" is written twice.`, fixes: [replaceWith("Take one out", "")] });
        }
        return out;
    },
};

// ---- length ----

const longSentence: Rule = {
    id: "prose-long-sentence",
    kind: "prose",
    severity: "advice",
    label: "Very long sentences",
    why: "A sentence much longer than the rest is hard to hold in the head; most can be two.",
    on: true,
    unit(unit, context) {
        if (!prose(unit) || unit.cell) return [];
        const most = context.settings.sentence;
        return unit.sentences.flatMap((span) => {
            const count = unit.words.filter((word) => word.from >= span.from && word.to <= span.to).length;
            return count > most ? [{ from: span.from, to: span.to, message: `This sentence has ${count} words; you set ${most} as long.` }] : [];
        });
    },
};

const longParagraph: Rule = {
    id: "prose-long-paragraph",
    kind: "prose",
    severity: "advice",
    label: "Very long paragraphs",
    why: "A long block of text tires the eye on a screen; a new paragraph gives it somewhere to rest.",
    on: true,
    unit(unit, context) {
        if (!prose(unit) || unit.cell || unit.heading || unit.block.kind !== "paragraph") return [];
        const count = unit.words.length;
        const most = context.settings.paragraph;
        // the whole paragraph would be one long line under the text, so only its first sentence is marked
        const first = unit.sentences[0];
        return count > most && first ? [{ from: first.from, to: first.to, message: `This paragraph has ${count} words; you set ${most} as long.` }] : [];
    },
};

// ---- the passive ----

/** Past participles that do not end in -ed. */
const IRREGULAR = "awoken been beaten become begun bent bet bitten bled blown broken brought built burnt bought caught chosen come cost cut dealt done drawn dreamt driven drunk eaten fallen fed felt fought found fled flown forbidden forgotten forgiven frozen got gotten given gone ground grown hung had heard hidden hit held hurt kept knelt known laid led leant learnt left lent let lain lit lost made meant met paid put quit read ridden rung risen run said seen sought sold sent set shaken shed shone shot shown shut sung sunk sat slain slept slid slung spoken spent spilt spun spat split spread sprung stood stolen stuck stung stunk struck strung sworn swept swum swung taken taught torn told thought thrown understood woken worn woven wept won wound written";
const PARTICIPLES = new Set(IRREGULAR.split(" "));
/** Words ending in -ed that are only adjectives after "is": "she is tired" is not passive. */
const STATES = new Set(["tired", "bored", "excited", "interested", "worried", "scared", "married", "used", "supposed", "based", "related", "involved", "concerned", "pleased", "surprised", "amused", "annoyed", "confused", "embarrassed", "frustrated", "satisfied", "disappointed", "finished", "done", "gone", "sophisticated", "advanced", "complicated", "detailed", "dedicated", "limited", "closed", "open", "named", "called", "needed"]);

const passive: Rule = {
    id: "prose-passive",
    kind: "prose",
    severity: "advice",
    label: "The passive",
    why: "\"The site was built by me\" hides who did it behind the verb; \"I built the site\" says it straight.",
    on: false,
    unit(unit) {
        if (!prose(unit)) return [];
        const out: Hit[] = [];
        const list = unit.words;
        for (let index = 0; index < list.length - 1; index++) {
            if (!/^(am|is|are|was|were|be|been|being|is|isn't|wasn't|aren't|weren't)$/i.test(list[index]!.word)) continue;
            let next = index + 1;
            // "is being made", "has been made"
            if (/^(being|been)$/i.test(list[next]!.word) && list[next + 1]) next++;
            // one adverb may stand between: "was quickly made"
            if (/ly$/i.test(list[next]!.word) && list[next + 1]) next++;
            const verb = list[next]!.word.toLowerCase();
            if (STATES.has(verb) || !(/[^e]ed$|[^aeiou]ed$/.test(verb) || PARTICIPLES.has(verb) || PARTICIPLES.has(verb.replace(/^(re|un|over|under|mis|out|fore)/, "")))) continue;
            // the words must sit in one sentence with only spaces between
            if (/[.,;:!?()]/.test(unit.read.text.slice(list[index]!.to, list[next]!.from))) continue;
            out.push({ from: list[index]!.from, to: list[next]!.to, message: "This may be the passive: who did it?" });
            index = next;
        }
        return out;
    },
};

// ---- weak openings and stock phrases ----

const STOCK: [RegExp, string, string?][] = [
    [/\beach and every\b/gi, "\"Each and every\" says \"each\" twice.", "each"],
    [/\bfirst and foremost\b/gi, "\"First and foremost\" is a stock phrase.", "first"],
    [/\blast but not least\b/gi, "\"Last but not least\" is a stock phrase."],
    [/\bdue to the fact that\b/gi, "\"Due to the fact that\" is a long way to say \"because\".", "because"],
    [/\bin spite of the fact that\b/gi, "\"In spite of the fact that\" is a long way to say \"although\".", "although"],
    [/\bat this point in time\b/gi, "\"At this point in time\" is a long way to say \"now\".", "now"],
    [/\bfor all intents and purposes\b/gi, "\"For all intents and purposes\" is a stock phrase."],
    [/\bin today's (?:world|day and age)\b/gi, "\"In today's world\" is a stock opening."],
    [/\bit is (?:important|worth) (?:to note|noting) that\b/gi, "This announces a point instead of making it."],
    [/\bit should be noted that\b/gi, "This announces a point instead of making it."],
    [/\bneedless to say,?\s*/gi, "If it needs no saying, it can go."],
    [/\bthe fact of the matter is\b/gi, "\"The fact of the matter is\" is throat-clearing."],
    [/\bwhen all is said and done\b/gi, "\"When all is said and done\" is a stock phrase."],
];

const stock: Rule = {
    id: "prose-stock",
    kind: "prose",
    severity: "advice",
    label: "Stock phrases",
    why: "A phrase everybody uses says less than the plain words it stands for.",
    on: true,
    unit(unit) {
        if (!prose(unit)) return [];
        const text = spoken(unit);
        const out: Hit[] = [];
        for (const [pattern, message, plain] of STOCK)
            for (const match of text.matchAll(pattern)) {
                const shaped = plain && match[0][0] !== match[0][0]!.toLowerCase() ? plain[0]!.toUpperCase() + plain.slice(1) : plain;
                out.push({ from: match.index, to: match.index + match[0].length, message, fixes: shaped ? [replaceWith(`Use "${shaped}"`, shaped)] : [] });
            }
        return out;
    },
};

const weakOpener: Rule = {
    id: "prose-opener",
    kind: "prose",
    severity: "advice",
    label: "Weak openings",
    why: "\"There is\" and \"It is ... that\" put an empty word where the subject should be; \"So,\" and \"Well,\" are speech.",
    on: true,
    unit(unit) {
        if (!prose(unit) || unit.heading || unit.cell) return [];
        const text = unit.read.text;
        const out: Hit[] = [];
        for (const span of unit.sentences) {
            const sentence = text.slice(span.from, span.to);
            const opener = /^(?:So|Well|Now),\s|^(?:There (?:is|are|was|were) \w+ (?:who|that|which)\b)|^It (?:is|was) \w+ (?:that|who)\b/.exec(sentence);
            if (opener) out.push({ from: span.from, to: span.from + opener[0].trimEnd().length, message: /^(So|Well|Now)/.test(opener[0]) ? `"${opener[0].trim()}" at the start of a sentence is how people talk, not how they write.` : "This opening puts an empty word where the subject should be." });
        }
        return out;
    },
};

// ---- adverbs ----

/** Words ending in -ly that are not adverbs. */
const NOT_ADVERBS = new Set(["only", "family", "early", "reply", "supply", "apply", "italy", "july", "fly", "holy", "ugly", "belly", "bully", "jelly", "lily", "rally", "silly", "daily", "weekly", "monthly", "yearly", "likely", "lovely", "friendly", "lonely", "lively", "elderly", "costly", "deadly", "orderly", "unlikely", "curly", "assembly", "anomaly", "butterfly", "ally", "rely", "comply", "imply", "multiply", "folly", "jolly", "dolly", "hilly", "chilly", "woolly", "oily", "wily", "surly", "burly", "melancholy", "monopoly", "homily", "doily", "sly", "ply", "poly", "kelly", "molly", "emily", "sally", "billy", "lily", "ely", "hourly", "nightly", "quarterly", "manly", "womanly", "bodily", "godly", "worldly", "cowardly", "scholarly", "kindly", "timely", "leisurely", "beastly", "ghastly", "heavenly", "measly", "prickly", "sickly", "smelly", "wobbly", "bubbly", "cuddly", "gnarly", "grisly", "lowly", "comely", "homely", "unruly", "unseemly", "ungodly"]);
const INTENSIFIERS = new Set(["very", "really", "quite", "rather", "extremely", "incredibly", "truly", "totally", "absolutely", "completely", "utterly", "highly", "deeply", "pretty", "super", "awfully", "terribly"]);
const adverb = (word: string) => {
    const lower = word.toLowerCase();
    return INTENSIFIERS.has(lower) || (lower.length > 4 && lower.endsWith("ly") && !NOT_ADVERBS.has(lower));
};

const adverbs: Rule = {
    id: "prose-adverbs",
    kind: "prose",
    severity: "advice",
    label: "Adverbs piled up",
    why: "Two or more adverbs together (\"really very quickly\") weaken each other; one stronger verb or adjective does more.",
    on: true,
    unit(unit) {
        if (!prose(unit)) return [];
        const out: Hit[] = [];
        const list = unit.words;
        for (let index = 0; index < list.length; index++) {
            let end = index;
            while (end + 1 < list.length && adverb(list[end]!.word) && adverb(list[end + 1]!.word) && /^[ \t]+$/.test(unit.read.text.slice(list[end]!.to, list[end + 1]!.from))) end++;
            if (end > index) {
                out.push({ from: list[index]!.from, to: list[end]!.to, message: `${end - index + 1} adverbs together.` });
                index = end;
            }
        }
        return out;
    },
};

// ---- the same word two ways ----

const twoWays: Rule = {
    id: "prose-two-spellings",
    kind: "prose",
    severity: "advice",
    label: "A word spelled two ways",
    why: "A document that says \"colour\" in one place and \"color\" in another reads as careless; pick one.",
    on: true,
    document(_doc: Document, units, context) {
        const speller = context.speller;
        if (!speller) return [];
        const seen = new Map<string, { unit: Unit; from: number; to: number; word: string }[]>();
        for (const unit of units) for (const word of unit.words) {
            const key = word.word.toLowerCase().replace(/’/g, "'");
            if (!seen.has(key)) seen.set(key, []);
            seen.get(key)!.push({ unit, ...word });
        }
        const out: Finding[] = [];
        const done = new Set<string>();
        for (const [key, places] of seen) {
            if (done.has(key)) continue;
            const other = speller.variant(key);
            const others = other ? seen.get(other) : undefined;
            if (!other || !others) continue;
            done.add(key).add(other);
            // the spelling used less is the one marked, with the one used more as its fix
            const [fewer, more, word] = places.length > others.length ? [others, places, key] : [places, others, other];
            for (const place of fewer) out.push(at(this, place.unit, place.from, place.to, `"${place.word}" is spelled "${more[0]!.word}" elsewhere in this document.`, [replaceWith(`Use "${word}"`, place.word[0] !== place.word[0]!.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word)]));
        }
        return out;
    },
};

// ---- quotation marks and apostrophes ----

const marks: Rule = {
    id: "prose-quotes",
    kind: "prose",
    severity: "advice",
    label: "Quotation marks of two kinds",
    why: "Straight quotes (\" and ') in one place and curly ones (“ ” ’) in another look untidy; use one kind throughout.",
    on: true,
    document(_doc, units) {
        type Mark = { unit: Unit; at: number; curly: boolean; char: string; apostrophe: boolean };
        const found: Mark[] = [];
        for (const unit of units) {
            if (!prose(unit)) continue;
            const text = unit.read.text;
            for (let index = 0; index < text.length; index++) {
                const char = text[index]!;
                if (unit.read.quiet[index] || !/["'“”‘’]/.test(char)) continue;
                const apostrophe = (char === "'" || char === "’") && /\p{L}/u.test(text[index - 1] ?? "") && /\p{L}/u.test(text[index + 1] ?? "");
                found.push({ unit, at: index, curly: /[“”‘’]/.test(char), char, apostrophe });
            }
        }
        const out: Finding[] = [];
        for (const apostrophe of [true, false]) {
            const group = found.filter((mark) => mark.apostrophe === apostrophe);
            const curly = group.filter((mark) => mark.curly).length;
            const straight = group.length - curly;
            if (!curly || !straight) continue;
            const odd = curly > straight ? false : true;
            for (const mark of group.filter((one) => one.curly === odd)) {
                const fix = apostrophe ? (odd ? "'" : "’") : odd ? (mark.char === "“" || mark.char === "”" ? "\"" : "'") : undefined;
                out.push(at(this, mark.unit, mark.at, mark.at + 1, apostrophe ? `This apostrophe is ${odd ? "curly" : "straight"}; the others in this document are ${odd ? "straight" : "curly"}.` : `This quotation mark is ${odd ? "curly" : "straight"}; the others in this document are ${odd ? "straight" : "curly"}.`, fix ? [replaceWith(`Use ${fix}`, fix)] : []));
            }
        }
        return out;
    },
};

// ---- capitals ----

const capital: Rule = {
    id: "prose-capital",
    kind: "prose",
    severity: "mistake",
    label: "A sentence with a small first letter",
    why: "A new sentence starts with a capital letter.",
    on: true,
    unit(unit, context) {
        // lists, cells, headings and quotations often start in small letters on purpose
        if (!prose(unit) || unit.cell || unit.listed || unit.quoted || unit.heading || unit.block.kind !== "paragraph") return [];
        const text = spoken(unit);
        const out: Hit[] = [];
        // a word the dictionary does not know in small letters is a name written that way on purpose (a command, a user name)
        const known = (word: string) => !context.speller || context.speller.known(word);
        const capitalize = (from: number, word: string) => out.push({ from, to: from + word.length, message: "A sentence starts with a capital letter.", fixes: [replaceWith(`Use "${word[0]!.toUpperCase()}${word.slice(1)}"`, word[0]!.toUpperCase() + word.slice(1))] });
        // after a full stop, question or exclamation mark and a space, not after an abbreviation or an ellipsis
        for (const match of text.matchAll(/[.!?]["'”’)]?\s+(\p{Ll}[\p{L}'’]*)/gu)) {
            const word = match[1]!;
            const before = /([\p{L}.]*)$/u.exec(text.slice(Math.max(0, match.index - 12), match.index))![1]!.toLowerCase();
            // an abbreviation (e.g., Mr.), an initial or an ellipsis does not end a sentence
            if (before.includes(".") || before.length === 1 || /^(etc|vs|cf|approx|mr|mrs|ms|dr|st|no|pp|ca|al)$/.test(before) || text[match.index - 1] === "…") continue;
            if (/\p{Lu}/u.test(word.slice(1)) || !known(word)) continue;
            // the space must be a space in the text, and not code blanked out
            if (!/^[.!?]["'”’)]?\s+$/.test(unit.read.text.slice(match.index, match.index + match[0].length - word.length))) continue;
            capitalize(match.index + match[0].length - word.length, word);
        }
        const first = /^\s*(\p{Ll}[\p{L}'’]*)/u.exec(text);
        if (first && !/\p{Lu}/u.test(first[1]!.slice(1)) && known(first[1]!)) capitalize(first[0].length - first[1]!.length, first[1]!);
        return out;
    },
};

/** The prose rules. */
export const PROSE: Rule[] = [repeated, longSentence, longParagraph, passive, stock, weakOpener, adverbs, twoWays, marks, capital];

/** How easy the document is to read: its Flesch reading ease and its average sentence length, from the units of a check. */
export function readability(units: Unit[]): { ease: number; sentence: number; words: number } {
    let wordCount = 0;
    let sentenceCount = 0;
    let syllableCount = 0;
    for (const unit of units) {
        if (!prose(unit) || unit.cell || unit.heading) continue;
        wordCount += unit.words.length;
        sentenceCount += unit.sentences.length;
        for (const word of unit.words) syllableCount += syllables(word.word);
    }
    return { ease: Math.round(readingEase(wordCount, sentenceCount, syllableCount)), sentence: sentenceCount ? Math.round((wordCount / sentenceCount) * 10) / 10 : 0, words: wordCount };
}
