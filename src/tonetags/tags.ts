// The tone tags the /tonetags/ page lists, and how its search finds them. A tone tag is a short
// mark put after a message, behind a slash, that says how the message is meant: "/j" for a joke,
// "/srs" for serious. They are a convention of people writing to each other online; nobody owns the
// list. The ones for sexual intent are left out, as the site leaves that subject out.

/** One tag: every way it is written (without the slash), what it means, and whether it is one of the few most used. */
export interface Tag {
    forms: string[];
    means: string;
    common?: true;
    /** Other words a person might search by. */
    also?: string;
}

/** The few that are seen every day come first, in the order they are listed here; the rest follow by letter. */
export const tags: Tag[] = [
    { forms: ["j"], means: "joking", common: true, also: "joke" },
    { forms: ["hj"], means: "half joking", common: true },
    { forms: ["srs"], means: "serious", common: true },
    { forms: ["gen", "g"], means: "genuine", common: true, also: "sincere" },
    { forms: ["s", "sarc"], means: "sarcastic", common: true, also: "sarcasm" },
    { forms: ["lh"], means: "light hearted", common: true },
    { forms: ["pos", "pc"], means: "positive connotation", common: true, also: "meant well" },
    { forms: ["neg", "nc"], means: "negative connotation", common: true, also: "meant badly" },
    { forms: ["nm"], means: "not mad", common: true, also: "angry" },
    { forms: ["p"], means: "platonic", common: true, also: "as a friend" },
    { forms: ["q"], means: "quote", common: true },
    { forms: ["rh", "rt"], means: "rhetorical question", common: true },
    { forms: ["gq", "genq"], means: "genuine question", common: true },
    { forms: ["t"], means: "teasing", common: true },
    { forms: ["nbh"], means: "nobody here", common: true, also: "not about anyone in this chat" },

    { forms: ["!"], means: "excited" },
    { forms: ["a"], means: "alterous", also: "between platonic and romantic" },
    { forms: ["ao"], means: "an order" },
    { forms: ["av"], means: "a vent", also: "venting" },
    { forms: ["ay"], means: "at you" },
    { forms: ["br"], means: "bragging" },
    { forms: ["c"], means: "copypasta", also: "copied and pasted" },
    { forms: ["calm"], means: "calm" },
    { forms: ["cb"], means: "clickbait" },
    { forms: ["cel"], means: "celebratory" },
    { forms: ["co", "cf"], means: "comforting" },
    { forms: ["curi"], means: "curious" },
    { forms: ["f"], means: "fake" },
    { forms: ["fam"], means: "familial", also: "as family" },
    { forms: ["fl"], means: "flirting" },
    { forms: ["fx"], means: "flex", also: "showing off" },
    { forms: ["gentle"], means: "gentle" },
    { forms: ["gs", "gens"], means: "genuine suggestion" },
    { forms: ["hyp"], means: "hyperbole", also: "exaggerating" },
    { forms: ["info"], means: "informing", also: "information" },
    { forms: ["irre"], means: "irrelevant" },
    { forms: ["jk"], means: "just kidding" },
    { forms: ["jw"], means: "just wondering" },
    { forms: ["l", "ly", "lyr"], means: "lyrics", also: "from a song" },
    { forms: ["li"], means: "literally" },
    { forms: ["lu"], means: "a little upset" },
    { forms: ["m"], means: "metaphorically", also: "metaphor" },
    { forms: ["nabr"], means: "not a brag" },
    { forms: ["nafx"], means: "not a flex" },
    { forms: ["nao"], means: "not an order" },
    { forms: ["naq"], means: "not a question" },
    { forms: ["nav"], means: "not a vent" },
    { forms: ["nay"], means: "not at you" },
    { forms: ["nbr"], means: "not being rude" },
    { forms: ["neu"], means: "neutral connotation" },
    { forms: ["nf"], means: "not fake" },
    { forms: ["nfl"], means: "not flirting" },
    { forms: ["nmay"], means: "not mad at you" },
    { forms: ["npa"], means: "not passive aggressive" },
    { forms: ["nsb"], means: "not subtweeting", also: "not about someone without naming them" },
    { forms: ["nsrs"], means: "not serious" },
    { forms: ["nsx", "nx"], means: "not sexual" },
    { forms: ["ny"], means: "not yelling" },
    { forms: ["ot"], means: "off topic" },
    { forms: ["pa"], means: "passive aggressive" },
    { forms: ["para"], means: "paraphrase", also: "in other words" },
    { forms: ["pf"], means: "playful" },
    { forms: ["qp"], means: "queerplatonic" },
    { forms: ["r"], means: "romantic" },
    { forms: ["sbh"], means: "somebody here", also: "about someone in this chat" },
    { forms: ["sbtw"], means: "subtweeting", also: "about someone without naming them" },
    { forms: ["st", "state"], means: "statement" },
    { forms: ["tan"], means: "tangent" },
    { forms: ["th"], means: "threat" },
    { forms: ["tic"], means: "a tic", also: "typed without meaning to" },
    { forms: ["ts"], means: "to self" },
    { forms: ["u"], means: "upset" },
    { forms: ["unin"], means: "unintentional" },
    { forms: ["unre"], means: "unrelated" },
    { forms: ["vu"], means: "very upset" },
    { forms: ["w"], means: "warm", also: "warmth" },
];

/** What was typed, made ready to look for: small letters, no slash in front, one space between words. */
export const tidy = (typed: string): string => typed.toLowerCase().replace(/^\s*\/+/, "").replace(/\s+/g, " ").trim();

/**
 * How well a tag answers what was typed: 3 when it is the tag itself ("j", "/srs"), 2 when a form of
 * the tag begins with it, 1 when its meaning or its other words hold it, and 0 when it does not match.
 * Typed with a slash, only the tags themselves are looked through. Nothing typed matches everything.
 */
export function match(tag: Tag, typed: string): 0 | 1 | 2 | 3 {
    const wanted = tidy(typed);
    if (!wanted) return 1;
    if (tag.forms.includes(wanted)) return 3;
    if (tag.forms.some((form) => form.startsWith(wanted))) return 2;
    // typed with its slash, it is a tag that is being looked for, not a word in a meaning
    if (/^\s*\//.test(typed)) return 0;
    const words = `${tag.means} ${tag.also ?? ""}`;
    // a letter or two only finds meanings that have a word beginning with it; "n" alone would find half the list
    return (wanted.length < 3 ? words.split(" ").some((word) => word.startsWith(wanted)) : words.includes(wanted)) ? 1 : 0;
}

/** The tags that answer what was typed, the closest first, otherwise in the list's own order. */
export function find(typed: string): Tag[] {
    return tags
        .map((tag, place) => ({ tag, place, score: match(tag, typed) }))
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.place - b.place)
        .map((each) => each.tag);
}
