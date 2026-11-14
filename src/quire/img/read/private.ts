// What looks private in the text read from a picture, found by plain rules written here: email
// addresses, phone numbers, keys and tokens (by the shapes their makers give them, and by long runs
// that look random), numbers shaped like a payment card that pass the Luhn check, street addresses,
// addresses of machines, and whatever follows a label such as "password" or "token". What is found is
// only offered: nothing here hides anything.
//
// The rules read one line at a time, its words joined by single spaces, and give the words a match
// touches. A word is given to one finding only, the first rule in RULES that takes it.
//
//   const found = lookPrivate(lines);   [{ kind: "email", text: "someone@example.com", words: [{ line: 1, word: 1 }] }]

import type { Line } from "./words";

/** The kinds of thing found, each as a person reads it. */
export const KINDS = { key: "key", card: "card number", email: "email", ip: "machine address", phone: "phone number", address: "street address", label: "secret", random: "key" } as const;

/** A kind of thing found. */
export type Kind = keyof typeof KINDS;

/** A word of a line, by their places. */
export interface Place {
    line: number;
    word: number;
}

/** Something that looks private: its kind, the text that matched, and the words it covers. */
export interface Finding {
    kind: Kind;
    text: string;
    words: Place[];
}

/** Whether a run of digits passes the Luhn check, as every payment card number does. */
export function luhn(digits: string): boolean {
    let sum = 0;
    for (let at = 0; at < digits.length; at++) {
        let value = Number(digits[digits.length - 1 - at]);
        if (at % 2 === 1) {
            value *= 2;
            if (value > 9) value -= 9;
        }
        sum += value;
    }
    return digits.length > 0 && sum % 10 === 0;
}

/** The Shannon entropy of a text, in bits for each character. */
export function entropy(text: string): number {
    const counts = new Map<string, number>();
    for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
    let bits = 0;
    for (const count of counts.values()) {
        const share = count / text.length;
        bits -= share * Math.log2(share);
    }
    return bits;
}

/** Tokens by the shapes their makers give them: GitHub, GitLab, npm, Hugging Face, OpenAI and Anthropic, Stripe, Amazon, Google, Slack, a JSON web token, and a private key's first line. */
const KEY_SHAPES = [
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bglpat-[A-Za-z0-9_-]{20,}/g,
    /\bnpm_[A-Za-z0-9]{30,}/g,
    /\bhf_[A-Za-z0-9]{30,}/g,
    /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}/g,
    /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CARD = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g;
const IPV6 = /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])/g;
const PHONE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,6}){1,4}(?![\w])/g;
const STREET_WORDS = "Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq|Close|Crescent|Cres";
const STREET = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:[A-Z][A-Za-z'-]*\\.?\\s+){1,4}(?:${STREET_WORDS})\\b\\.?(?:,?\\s*(?:Apt|Apartment|Suite|Unit|Flat|#)\\.?\\s*[\\w-]+)?(?:,\\s*[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*,?\\s*[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?)?`, "g");
const TOWN = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g;
/** Labels whose value is a secret, as they are written before it. */
const LABELS = ["password", "passwd", "pwd", "passcode", "passphrase", "pin", "token", "secret", "api key", "apikey", "api_key", "access key", "secret key", "private key", "key", "otp", "security code", "cvv", "cvc", "ssn", "social security number", "recovery code", "backup code", "auth code", "verification code", "client secret", "access token", "bearer"];
const LABEL = new RegExp(`(?<![\\w])(?:${LABELS.map((label) => label.replace(" ", "[ _-]?")).join("|")})\\s*[:=]\\s*(\\S.*)$`, "i");
const LABEL_ALONE = new RegExp(`^(?:${LABELS.map((label) => label.replace(" ", "[ _-]?")).join("|")})\\s*:?$`, "i");

/** Whether a phone-shaped match is a phone number and not a date, a time, a version or an amount. */
function phoneLike(match: string): boolean {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return false;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(match) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(match)) return false;
    if (/^\d+(?:\.\d+){3}$/.test(match)) return false;
    return match.startsWith("+") || match.includes("(") || digits.length >= 10 || /^\d{3}[-.\s]\d{4}$/.test(match);
}

/** Whether a word looks like a random key: long, of the characters keys are written in, and random enough. */
export function randomLike(word: string): boolean {
    const bare = word.replace(/^[^\w+/=-]+|[^\w+/=-]+$/g, "");
    if (bare.length < 20 || !/^[A-Za-z0-9+/=_-]+$/.test(bare)) return false;
    if (/^[0-9a-f]{32,}$/i.test(bare)) return true;
    const digits = (bare.match(/\d/g) ?? []).length;
    const letters = (bare.match(/[A-Za-z]/g) ?? []).length;
    const bits = entropy(bare);
    return (digits >= 2 && letters >= 2 && bits >= 3.5) || bits >= 4.3;
}

/** One rule: the kind it finds and the parts of a line's text it takes. */
interface Rule {
    kind: Kind;
    find(text: string): { start: number; end: number }[];
}
const all = (pattern: RegExp, keep: (match: string) => boolean = () => true) => (text: string) => [...text.matchAll(pattern)].filter((match) => keep(match[0])).map((match) => ({ start: match.index!, end: match.index! + match[0].length }));

/** The rules, in the order they take words. */
export const RULES: Rule[] = [
    { kind: "key", find: (text) => KEY_SHAPES.flatMap((shape) => all(shape)(text)) },
    { kind: "card", find: all(CARD, (match) => luhn(match.replace(/\D/g, ""))) },
    { kind: "email", find: all(EMAIL) },
    { kind: "ip", find: (text) => [...all(IPV4)(text), ...all(IPV6, (match) => (match.includes("::") || match.split(":").length >= 5) && /[0-9]/.test(match) && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(match))(text)] },
    { kind: "phone", find: all(PHONE, phoneLike) },
    { kind: "address", find: (text) => [...all(STREET)(text), ...all(TOWN)(text)] },
    {
        kind: "label",
        find(text) {
            const match = LABEL.exec(text);
            return match ? [{ start: match.index + match[0].length - match[1]!.length, end: text.length }] : [];
        },
    },
    {
        kind: "random",
        find(text) {
            const found: { start: number; end: number }[] = [];
            for (const match of text.matchAll(/\S+/g)) if (randomLike(match[0])) found.push({ start: match.index!, end: match.index! + match[0].length });
            return found;
        },
    },
];

/** What looks private in the lines read, each thing with the words it covers. */
export function lookPrivate(lines: Pick<Line, "words">[]): Finding[] {
    const taken = new Set<string>();
    const found: Finding[] = [];
    const take = (kind: Kind, places: Place[], text: string) => {
        const fresh = places.filter((place) => !taken.has(`${place.line},${place.word}`));
        if (!fresh.length) return;
        for (const place of fresh) taken.add(`${place.line},${place.word}`);
        found.push({ kind, text, words: fresh });
    };
    const texts = lines.map((line) => {
        // the line's text, and for each character the word it is in (-1 for the spaces between)
        let text = "";
        const owner: number[] = [];
        line.words.forEach((word, index) => {
            if (index) {
                text += " ";
                owner.push(-1);
            }
            text += word.text;
            for (let at = 0; at < word.text.length; at++) owner.push(index);
        });
        return { text, owner };
    });
    for (const rule of RULES)
        texts.forEach(({ text, owner }, line) => {
            for (const { start, end } of rule.find(text)) {
                const words = [...new Set(owner.slice(start, end).filter((index) => index >= 0))].map((word) => ({ line, word }));
                take(rule.kind, words, text.slice(start, end).trim());
            }
            // a label alone on its line: its value is the next line
            if (rule.kind === "label" && LABEL_ALONE.test(text.trim()) && texts[line + 1]?.text.trim()) take("label", lines[line + 1]!.words.map((_, word) => ({ line: line + 1, word })), texts[line + 1]!.text);
        });
    return found.sort((a, b) => a.words[0]!.line - b.words[0]!.line || a.words[0]!.word - b.words[0]!.word);
}
