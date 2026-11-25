// Grammar: mdQuire's own rules for mistakes that are spelled right (a past tense for a participle,
// "this" with a plural, a language without its capital, a hyphen standing in for a dash), and the rules
// that read what Harper found (harper.ts, in a worker). Grammar is on from the start and marks only what
// it is sure of; what it may be wrong about waits in the stricter rules, off until switched on. The
// owner chose this on 24 November 2026, after mdQuire let much through in a short story.
//
// Every rule here was held against the site's own posts, pages and notes, which are taken as right:
// a rule that starts on finds nothing there (grammar.test.ts). Harper's rules that did find something
// there are the stricter ones, by name, in NOISY.

import { insertText, type Document } from "../document";
import { perUnit, replaceWith, type Context, type Finding, type Fix, type Hit, type Lint, type Rule, type Unit } from "./engine";
import { spoken } from "./prose";

/** A unit whose words are prose: not code, not a raw block. */
const prose = (unit: Unit) => !unit.code && !!unit.runs;

/** True if any letter from `from` to `to` (and one either side) is quiet: code or an address, blanked in the spoken text. */
function nearQuiet(unit: Unit, from: number, to: number): boolean {
    const { quiet } = unit.read;
    for (let index = Math.max(0, from - 1); index <= Math.min(quiet.length - 1, to); index++) if (quiet[index]) return true;
    return false;
}

/** Every match of a pattern in a unit's spoken text that touches no code, as hits. */
function matches(unit: Unit, pattern: RegExp, hit: (match: RegExpExecArray, text: string) => Hit | undefined): Hit[] {
    if (!prose(unit)) return [];
    const text = spoken(unit);
    const out: Hit[] = [];
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (let match = global.exec(text); match; match = global.exec(text)) {
        if (nearQuiet(unit, match.index, match.index + match[0].length)) continue;
        const one = hit(match, text);
        if (one) out.push(one);
    }
    return out;
}

/** A word written as another is: capitalised if it was, in capitals if it was. */
export function like(was: string, word: string): string {
    if (was.length > 1 && was === was.toUpperCase()) return word.toUpperCase();
    if (/^\p{Lu}/u.test(was)) return word[0]!.toUpperCase() + word.slice(1);
    return word;
}

/** A fix that puts `word` where a matched word was, in the same case. */
const use = (was: string, word: string) => replaceWith(`Use "${like(was, word)}"`, like(was, word));

// ---- a hyphen for a dash ----

const dash: Rule = {
    id: "grammar-dash",
    kind: "grammar",
    severity: "mistake",
    label: "A hyphen used as a dash",
    why: "A hyphen joins words; between two parts of a sentence the mark is a dash.",
    on: true,
    unit(unit) {
        // a hyphen or two with a space either side, between words, and not between two numbers (a sum or a range)
        return matches(unit, /(?<=[\p{L}\p{N},.!?…"'”’)])( -{1,2} )(?=[\p{L}\p{N}"“'‘(])/gu, (match, text) => {
            const before = /([\p{L}\p{N}]*)[^\p{L}\p{N}]*$/u.exec(text.slice(Math.max(0, match.index - 20), match.index))![1]!;
            const after = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
            const next = /^[\p{L}\p{N}]*/u.exec(after)![0];
            // sums and formulas written in prose (width - 1 - x, 1 - e, sin - cos in brackets): a figure or a single letter beside it,
            // a sign soon after it, or an open bracket before it in the sentence
            if (/\p{N}/u.test(before + next) || before.length === 1 || next.length === 1) return undefined;
            if (/^[\p{L}\p{N}]*\s*\p{L}*\s*[_#/\\^=+*<>]/u.test(after)) return undefined;
            const sentence = text.slice(Math.max(0, text.lastIndexOf(".", match.index) + 1), match.index);
            if (sentence.lastIndexOf("(") > sentence.lastIndexOf(")")) return undefined;
            // the spaces must be spaces in the text, and not code blanked out
            if (unit.read.text.slice(match.index, match.index + match[0].length) !== match[0]) return undefined;
            return { from: match.index, to: match.index + match[0].length, message: "A hyphen used as a dash.", fixes: [replaceWith("Use a dash (—)", "—"), replaceWith("Use a comma", ", ")] };
        });
    },
};

// ---- a participle for a past tense, and a past tense after "have" ----

/** Verbs whose past tense and participle differ: the participle, then the past tense. */
const FORMS: [string, string][] = [
    ["sung", "sang"],
    ["rung", "rang"],
    ["sunk", "sank"],
    ["swum", "swam"],
    ["drunk", "drank"],
    ["shrunk", "shrank"],
    ["sprung", "sprang"],
    ["stunk", "stank"],
    ["begun", "began"],
    ["seen", "saw"],
    ["done", "did"],
    ["gone", "went"],
    ["eaten", "ate"],
    ["written", "wrote"],
    ["taken", "took"],
    ["given", "gave"],
    ["spoken", "spoke"],
    ["broken", "broke"],
    ["driven", "drove"],
    ["ridden", "rode"],
    ["flown", "flew"],
    ["thrown", "threw"],
    ["grown", "grew"],
    ["known", "knew"],
    ["chosen", "chose"],
    ["fallen", "fell"],
    ["stolen", "stole"],
    ["frozen", "froze"],
    ["woken", "woke"],
    ["worn", "wore"],
    ["torn", "tore"],
    ["shaken", "shook"],
    ["come", "came"],
    ["run", "ran"],
];
const PAST_OF = new Map(FORMS);
const PARTICIPLE_OF = new Map(FORMS.map(([participle, past]) => [past, participle]));
/** Words that stand for whoever does something, before a verb in the past. */
const SUBJECTS = new Set(["i", "you", "he", "she", "we", "they", "everyone", "everybody", "someone", "somebody", "nobody", "noone"]);
/** Participles that, after a noun with a determiner before it ("the staff sung"), are a past tense written wrong: none is also an ordinary adjective or noun there. */
const AFTER_NOUN = new Set(["sung", "swum", "begun", "sprung", "stunk"]);
const DETERMINERS = new Set(["the", "a", "an", "his", "her", "their", "my", "our", "your", "its", "this", "that", "these", "those"]);
/** Words of "have" that take a participle. */
const HAVE = new Set(["have", "has", "had", "having", "'ve", "’ve"]);
/** Words that, before the subject, make a question or a clause in which a participle is right: "have you seen", "are you done". */
const AUXILIARIES = new Set(["have", "has", "had", "is", "are", "was", "were", "am", "be", "been", "being", "do", "does", "did", "will", "would", "can", "could", "should", "shall", "may", "might", "must", "get", "got", "gets", "haven't", "hasn't", "hadn't", "isn't", "aren't", "wasn't", "weren't", "didn't", "won't", "wouldn't", "couldn't", "shouldn't"]);
/** Words that may stand between "have" and its participle. */
const BETWEEN = new Set(["not", "never", "already", "just", "ever", "also", "only", "since", "all", "both", "finally", "nearly", "almost"]);

const pastForm: Rule = {
    id: "grammar-past",
    kind: "grammar",
    severity: "mistake",
    label: "A past tense and a participle mixed up",
    why: "\"They sang\" but \"they have sung\": the past tense stands alone, and the participle comes after have.",
    on: true,
    unit(unit) {
        if (!prose(unit)) return [];
        const text = spoken(unit);
        const words = unit.words.filter((one) => !nearQuiet(unit, one.from, one.to));
        const out: Hit[] = [];
        words.forEach((one, index) => {
            const lower = one.word.toLowerCase();
            // the words before, in the same sentence (nothing but spaces between them)
            const joined = (a: number) => a >= 0 && /^\s+$/.test(text.slice(words[a]!.to, words[a + 1]?.from ?? one.from));
            const previous = joined(index - 1) ? words[index - 1]!.word.toLowerCase() : undefined;
            const next = words[index + 1] && /^\s+$/.test(text.slice(one.to, words[index + 1]!.from)) ? words[index + 1]!.word.toLowerCase() : undefined;
            const past = PAST_OF.get(lower);
            // "they seen it", "the staff sung him": a participle with no "have" or "be", not a passive with "by"
            if (past && previous && next !== "by" && lower !== "come" && lower !== "run") {
                const beforeSubject = index >= 2 && joined(index - 2) ? words[index - 2]!.word.toLowerCase().replace(/’/g, "'") : undefined;
                const subject = SUBJECTS.has(previous) && !(beforeSubject && AUXILIARIES.has(beforeSubject));
                const nounBefore = AFTER_NOUN.has(lower) && index >= 2 && joined(index - 2) && DETERMINERS.has(words[index - 2]!.word.toLowerCase()) && !DETERMINERS.has(previous) && !/ly$/.test(previous);
                if (subject || nounBefore) out.push({ from: one.from, to: one.to, message: `"${one.word}" goes after have; on its own the past tense is "${like(one.word, past)}".`, fixes: [use(one.word, past)] });
            }
            // "had went", "have never came": a past tense after have
            const participle = PARTICIPLE_OF.get(lower);
            if (participle && previous) {
                let back = index - 1;
                while (back >= 0 && joined(back) && BETWEEN.has(words[back]!.word.toLowerCase())) back--;
                if (back >= 0 && joined(back) && HAVE.has(words[back]!.word.toLowerCase().replace(/^[a-z]+(?='ve|’ve)/, ""))) out.push({ from: one.from, to: one.to, message: `After have, "${one.word}" is "${like(one.word, participle)}".`, fixes: [use(one.word, participle)] });
            }
        });
        return out;
    },
};

// ---- "this" with a plural ----

/** Words ending in s that are not plurals, or that a plural test would take for one. */
const NOT_PLURAL = new Set(
    "is was has does this us its his hers yours ours theirs yes less unless plus thus bus gas lens news means series species physics mathematics politics economics ethics always perhaps sometimes besides towards afterwards nevertheless across chaos canvas census corps alias bias iris status virus campus bonus focus genus atlas analysis basis crisis thesis axis kudos lyrics mumps measles billiards".split(" "),
);
/** Verbs that agree with a plural, after which "this" cannot be right. */
const PLURAL_VERBS = new Set(["are", "were", "have", "aren't", "weren't", "haven't", "arent", "werent", "havent", "aren’t", "weren’t", "haven’t"]);

/** True if a word is a plural of a word the speller knows: "hallways", "boxes", "stories". */
function plural(word: string, context: Context): boolean {
    const lower = word.toLowerCase();
    if (lower.length < 4 || !lower.endsWith("s") || lower.endsWith("ss") || lower.endsWith("us") || lower.endsWith("is") || NOT_PLURAL.has(lower) || /['’]/.test(lower)) return false;
    const speller = context.speller;
    if (!speller?.known(lower)) return false;
    const stems = [lower.slice(0, -1), lower.endsWith("es") ? lower.slice(0, -2) : "", lower.endsWith("ies") ? `${lower.slice(0, -3)}y` : ""].filter((stem) => stem.length >= 3);
    return stems.some((stem) => speller.known(stem));
}

const thisPlural: Rule = {
    id: "grammar-this-plural",
    kind: "grammar",
    severity: "mistake",
    label: "\"This\" with a plural",
    why: "This and that go with one thing; these and those with more than one.",
    on: true,
    unit(unit, context) {
        if (!prose(unit) || !context.speller) return [];
        const text = spoken(unit);
        const words = unit.words.filter((one) => !nearQuiet(unit, one.from, one.to));
        const spaced = (a: number, b: number) => /^\s+$/.test(text.slice(words[a]!.to, words[b]!.from));
        const out: Hit[] = [];
        words.forEach((one, index) => {
            if (one.word.toLowerCase() !== "this") return;
            const at = (step: number) => (words[index + step] && Array.from({ length: step }, (_, k) => spaced(index + k, index + k + 1)).every(Boolean) ? words[index + step]!.word : undefined);
            // "this hallways are", or "this seemingly endless hallways": a plural, with a verb that agrees with it, or after an adverb and one more word
            const first = at(1);
            const afterVerb = first && plural(first, context) && PLURAL_VERBS.has((at(2) ?? "").toLowerCase());
            const third = at(3);
            const afterAdverb = /ly$/i.test(first ?? "") && at(2) && !/s$/i.test(at(2)!) && third && plural(third, context);
            if (afterVerb || afterAdverb) out.push({ from: one.from, to: one.to, message: `"${one.word}" goes with one thing; with more than one it is "${like(one.word, "these")}".`, fixes: [use(one.word, "these")] });
        });
        return out;
    },
};

// ---- capitals for languages, peoples, days and months ----

/** Words that are always written with a capital in English. May, March and August are left out, being words too, and Polish, being polish. */
const CAPITALS = new Set(
    "english french spanish german italian portuguese russian japanese chinese korean arabic hindi thai vietnamese indonesian tamil telugu bengali urdu persian swahili ukrainian czech hungarian romanian bulgarian serbian croatian dutch swedish norwegian danish finnish greek turkish hebrew latin irish scottish welsh british american canadian australian mexican european african asian christian muslim jewish catholic buddhist hindu monday tuesday wednesday thursday friday saturday sunday january february april june july september october november december".split(
        " ",
    ),
);
/** Things named after a people that are written in small letters as often as not. */
const SMALL_AFTER = new Set(["fries", "fry", "toast", "kiss", "kissing", "kissed", "press", "braid", "braids", "door", "doors", "horn", "horns", "dressing", "window", "windows"]);

const capitals: Rule = {
    id: "grammar-capitals",
    kind: "grammar",
    severity: "mistake",
    label: "Languages, days and months in small letters",
    why: "Languages, nationalities, days and months are names, and take a capital.",
    on: true,
    outranks: ["spelling"],
    unit(unit) {
        // a word in a file name or address (audit-16-november.md) is not written as prose
        return matches(unit, /(?<![\p{L}\p{N}_./-])\p{Ll}+(?![\p{L}\p{N}_/-]|\.\p{L})/gu, (match, text) => {
            const word = match[0];
            if (!CAPITALS.has(word)) return undefined;
            // a list of them in small letters (english, latin, arabic) is a list of names as a program writes them
            const neighbours = [/(\p{Ll}+),\s*$/u.exec(text.slice(Math.max(0, match.index - 20), match.index))?.[1], /^,\s*(\p{Ll}+)/u.exec(text.slice(match.index + word.length))?.[1]];
            if (neighbours.some((one) => one && CAPITALS.has(one))) return undefined;
            const next = /^\s+(\p{L}+)/u.exec(text.slice(match.index + word.length))?.[1]?.toLowerCase();
            if (next && SMALL_AFTER.has(next)) return undefined;
            const right = word[0]!.toUpperCase() + word.slice(1);
            return { from: match.index, to: match.index + word.length, message: `"${right}" is a name, and takes a capital.`, fixes: [replaceWith(`Use "${right}"`, right)] };
        });
    },
};

// ---- an age, hyphenated ----

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";

const age: Rule = {
    id: "grammar-age",
    kind: "grammar",
    severity: "mistake",
    label: "An age written without its hyphens",
    why: "\"An 18-year-old\" and \"an 18-year-old's party\" are one word, joined by hyphens.",
    on: true,
    unit(unit) {
        return matches(unit, new RegExp(`\\b(\\d+|${NUMBER_WORDS})([ -])(year|month|week|day)([ -])old(?![\\p{L}-])`, "giu"), (match) => {
            if (match[2] === "-" && match[4] === "-") return undefined;
            const right = `${match[1]}-${match[3]}-old`;
            return { from: match.index, to: match.index + match[0].length, message: `An age before a noun, or standing for a person, is written "${right}".`, fixes: [replaceWith(`Use "${right}"`, right)] };
        });
    },
};

// ---- two full stops ----

const twoStops: Rule = {
    id: "grammar-two-stops",
    kind: "grammar",
    severity: "mistake",
    label: "Two full stops",
    why: "A sentence ends with one full stop; a trailing off is three, or an ellipsis.",
    on: true,
    unit(unit) {
        return matches(unit, /(?<=[\p{L}\p{N}"'”’)])\.\.(?![./\\\p{L}\p{N}])/gu, (match, text) => {
            // a small letter after it means the sentence goes on: it trailed off, and the mark for that is an ellipsis
            const goesOn = /^\s*\p{Ll}/u.test(text.slice(match.index + 2));
            const fixes = goesOn ? [replaceWith("Use an ellipsis (…)", "…")] : [replaceWith("Use one", "."), replaceWith("Use an ellipsis (…)", "…")];
            return { from: match.index, to: match.index + 2, message: goesOn ? "Two full stops, where the sentence trails off." : "Two full stops.", fixes };
        });
    },
};

// ---- words that sound alike ----

/** Each a pattern of a slip and what it should be: "your" for "you're", "loose" for "lose", a place gone to with no "to". */
const SOUNDS: { pattern: RegExp; right: (match: RegExpExecArray) => string; message: string; part: (match: RegExpExecArray) => [number, string] }[] = [
    {
        // "your welcome", "your a star", "your right."
        pattern: /\b(your)(?=\s+(?:welcome|kidding|joking|gonna|an|the|not)\b|\s+(?:right|wrong|correct|sure)(?=\s*(?:[.,!?;:]|$|about\b)))/giu,
        right: () => "you're",
        message: "\"Your\" is something of yours; \"you're\" is you are.",
        part: (match) => [match.index, match[1]!],
    },
    {
        // "don't loose your keys", "to loose weight"
        pattern: /\b(?:to|will|would|could|can|might|may|must|should|don't|didn't|won't|not|never|gonna|don’t|didn’t|won’t)\s+(loose)\b/giu,
        right: () => "lose",
        message: "\"Loose\" is not tight; to mislay something is to \"lose\" it.",
        part: (match) => [match.index + match[0].length - match[1]!.length, match[1]!],
    },
    {
        // "went the store": a place gone to, with no "to"
        pattern: /\b(?:went|go|goes|going|gone)\s+(the)\s+(?:store|shop|mall|park|beach|bank|gym|library|hospital|office|airport|station|movies|doctor|dentist|pharmacy|supermarket)\b/giu,
        right: (match) => `to ${match[1]}`,
        message: "A word is missing: one goes to a place.",
        part: (match) => [match.index + match[0].indexOf(` ${match[1]} `) + 1, match[1]!],
    },
    {
        // "non stop", "non profit": one word
        pattern: /\b(non (?:stop|profit|existent|sense|fiction))\b/giu,
        right: (match) => match[1]!.replace(" ", ""),
        message: "One word, written together.",
        part: (match) => [match.index, match[1]!],
    },
];

const soundsAlike: Rule = {
    id: "grammar-sounds-alike",
    kind: "grammar",
    severity: "mistake",
    label: "Words that sound alike, and a word missing",
    why: "Your and you're, loose and lose sound the same, so the spelling check cannot tell them apart.",
    on: true,
    unit(unit) {
        return SOUNDS.flatMap(({ pattern, right, message, part }) =>
            matches(unit, pattern, (match) => {
                const [from, was] = part(match);
                const word = like(was, right(match));
                return { from, to: from + was.length, message, fixes: [replaceWith(`Use "${word}"`, word)] };
            }),
        );
    },
};

// ---- names written wrong ----

/** Names of places and things often written wrong, each a pattern and the name as it is written. */
const NAMES: [RegExp, string][] = [
    // a possessive ending written after it, the second group, is kept
    [/\b(chuck(?:y|ie)?(?:\s+e\.?)?\s+cheese)('s|’s)?(?!\p{L})/giu, "Chuck E. Cheese"],
    [/\b(mc\s?donald'?s)()(?!\p{L})/giu, "McDonald's"],
    [/\b(walmart)('s|’s)?(?!\p{L})/gu, "Walmart"],
    [/\b(starbucks)()(?!\p{L})/gu, "Starbucks"],
    [/\b(youtube)('s|’s)?(?!\p{L})/giu, "YouTube"],
];

const names: Rule = {
    id: "grammar-names",
    kind: "grammar",
    severity: "mistake",
    label: "Names of places and things written wrong",
    why: "A name is written as its owner writes it.",
    on: true,
    outranks: ["spelling"],
    unit(unit) {
        return NAMES.flatMap(([pattern, name]) =>
            matches(unit, pattern, (match) => {
                if (match[1] === name) return undefined;
                return { from: match.index, to: match.index + match[1]!.length, message: `The name is written "${name}".`, fixes: [replaceWith(`Use "${name}"`, name)] };
            }),
        );
    },
};

// ---- numbers, spelled out (stricter) ----

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const numbers: Rule = {
    id: "grammar-numbers",
    kind: "grammar",
    severity: "advice",
    label: "Small numbers written as figures",
    why: "In running prose, one to nine are usually written as words.",
    on: false,
    unit(unit) {
        // a figure standing alone between words: not a measurement, a time, a date, a version or a list number
        return matches(unit, /(?<=\p{L}[ ])([1-9])(?=[ ]\p{L})/gu, (match, text) => {
            const after = /^ (\p{L}+)/u.exec(text.slice(match.index + 1))?.[1] ?? "";
            if (/^(am|pm|kb|mb|gb|tb|ms|px|cm|mm|km|kg|mph|percent|x|p|d|k|st|nd|rd|th)$/i.test(after)) return undefined;
            const word = SMALL[Number(match[1])]!;
            return { from: match.index, to: match.index + 1, message: `In prose, "${word}" reads more easily than the figure.`, fixes: [replaceWith(`Use "${word}"`, word)] };
        });
    },
};

// ---- what Harper found ----

/** Harper's rules mdQuire has its own better ones for, or that are a matter of taste: never shown. */
const REPLACED = new Set(["SpellCheck", "SentenceCapitalization", "RepeatedWords", "LongSentences", "SpelledNumbers", "OxfordComma", "NoOxfordComma", "QuiteQuiet", "Dashes", "AvoidCurses", "AvoidContractions", "BoringWords"]);
/**
 * Harper's rules that marked something in the site's own posts, pages or notes on 24 November 2026
 * (7,820 paragraphs, taken as right), so are not sure enough to start on: they are the stricter rules.
 * Rules are added to Harper often; a new one starts as sure unless its kind is a matter of style.
 */
const NOISY = new Set(
    "ExpandMemoryShorthands ExpandTimeShorthands OrthographicConsistency SplitWords ExpandControl CompoundNouns MergeWords DisjointPrefixes MassNouns WrongNegative SingleBe MissingTo MissingPreposition Months Everyone PhrasalVerbAsCompoundNoun Spaces UseEllipsisCharacter LetsConfusion ItsContraction ToTwoToo DiscourseMarkers RightClick ExpandConfiguration CondenseAllThe Excellent ThereIsAgreement QuantifierNumeralConflict OutOfDate ExpandStandardInputAndOutput HowTo ArriveTo InAWhile Everybody DayOneNames TransposedSpace AppleNames RoadMap ThereToTheir ExpandBecause ToBeHonest TheirToThere ExpandAlloc DoubleClick InflectedVerbAfterTo NumericRangeEnDash WayTooAdjective Therein PassedPast ForNoun VerbToAdjective FindFine OkToOkay The PronounVerbAgreement".split(
        " ",
    ),
);
/** Kinds of Harper's rules that are about style, not mistakes: stricter. */
const STYLE = new Set(["Style", "Readability", "Enhancement"]);

/** Whether a rule of Harper's is shown: never, as sure, or only as stricter. */
export function harperTier(rule: string, kind: string): "never" | "sure" | "strict" {
    if (REPLACED.has(rule)) return "never";
    return NOISY.has(rule) || STYLE.has(kind) ? "strict" : "sure";
}

/** The text of a unit as Harper is sent it: its spoken text, with a line broken inside a paragraph read as a space. Offsets into it are the unit's own. */
export const harperText: (unit: Unit) => string = perUnit((unit) => spoken(unit).replace(/\n/g, " "));

/** A fix from one of Harper's: what to put in the lint's place, or after it. */
function harperFix(fix: Lint["fixes"][number]): Fix {
    if (fix.after) return { label: `Add "${fix.text.trim()}"`, edit: (doc: Document, range) => insertText(doc, range.end, fix.text) };
    if (!fix.text) return replaceWith("Take it out", "");
    return replaceWith(`Use "${fix.text}"`, fix.text);
}

/** One of the two rules that read what Harper found, the sure lints or the stricter ones. */
function harper(tier: "sure" | "strict"): Rule {
    const id = tier === "sure" ? "grammar-harper" : "grammar-harper-strict";
    const severity = tier === "sure" ? "mistake" : "advice";
    return {
        id,
        kind: "grammar",
        severity,
        label: tier === "sure" ? "Agreement, word choice and punctuation" : "Stricter: style, and what may be right",
        why: tier === "sure" ? "Harper's grammar rules, those that found nothing in writing known to be right." : "Harper's rules that are a matter of style, or that also marked writing known to be right.",
        on: tier === "sure",
        // read from what Harper has answered each time, since answers come after the units were checked
        document(_doc, units, context) {
            if (!context.grammar) return [];
            const out: Finding[] = [];
            for (const unit of units) {
                if (!prose(unit) || unit.heading) continue;
                const text = harperText(unit);
                if (!text.trim()) continue;
                for (const lint of context.grammar.lints(text) ?? []) {
                    if (harperTier(lint.rule, lint.kind) !== tier || nearQuiet(unit, lint.from, lint.to)) continue;
                    out.push({
                        rule: id,
                        kind: "grammar",
                        severity,
                        range: { start: { path: unit.path, offset: lint.from }, end: { path: unit.path, offset: lint.to } },
                        message: lint.message,
                        fixes: lint.fixes.slice(0, 5).map(harperFix),
                    });
                }
            }
            return out;
        },
    };
}

/** The grammar rules, in the order the settings list them. */
export const GRAMMAR: Rule[] = [harper("sure"), dash, pastForm, thisPlural, capitals, age, twoStops, soundsAlike, names, harper("strict"), numbers];
