// The tone tags the /tonetags/ page lists, and how its search finds them. A tone tag is a short
// mark put after a message, behind a slash, that says how the message is meant: "/j" for a joke,
// "/srs" for serious. They are a convention of people writing to each other online; nobody owns the
// list. The ones for sexual intent are left out, as the site leaves that subject out.
//
// The search is a small dictionary written by hand: beside each tag are the words a person might
// type when they mean it ("angry" for /nm, "song" for /l). What is typed is cut into words, each
// brought to its stem, and a tag is found by how many of them are among its own. There is no model
// and nothing to download.

/** One tag: every way it is written (without the slash), what it means, whether it is one of the few most used, and the words it is found by. */
export interface Tag {
    forms: string[];
    means: string;
    common?: true;
    /** Words and phrases a person might type when this tag is what they mean. */
    said: string;
}

/** The few that are seen every day come first, in the order they are listed here; the rest follow by letter. */
export const tags: Tag[] = [
    { forms: ["j"], means: "joking", common: true, said: "joke joking kidding funny not serious messing" },
    { forms: ["hj"], means: "half joking", common: true, said: "half joke joking partly kind of serious sort of" },
    { forms: ["srs"], means: "serious", common: true, said: "serious seriously mean it not joking for real honest" },
    { forms: ["gen", "g"], means: "genuine", common: true, said: "genuine genuinely sincere sincerely really mean it honest truly" },
    { forms: ["s", "sarc"], means: "sarcastic", common: true, said: "sarcasm sarcastic sarcastically ironic irony opposite" },
    { forms: ["lh"], means: "light hearted", common: true, said: "light hearted lighthearted casual easy going no pressure relaxed" },
    { forms: ["pos", "pc"], means: "positive connotation", common: true, said: "positive good way nice compliment meant well kindly" },
    { forms: ["neg", "nc"], means: "negative connotation", common: true, said: "negative bad way insult meant badly unkind" },
    { forms: ["nm"], means: "not mad", common: true, said: "not mad angry annoyed cross upset fine" },
    { forms: ["p"], means: "platonic", common: true, said: "platonic friend friends friendly friendship as a friend love you" },
    { forms: ["q"], means: "quote", common: true, said: "quote quoting quoted someone said saying" },
    { forms: ["rh", "rt"], means: "rhetorical question", common: true, said: "rhetorical question no answer needed do not answer" },
    { forms: ["gq", "genq"], means: "genuine question", common: true, said: "genuine question really asking real question want to know honestly asking" },
    { forms: ["t"], means: "teasing", common: true, said: "tease teasing poking fun playful banter" },
    { forms: ["nbh"], means: "nobody here", common: true, said: "nobody here no one here not about anyone in this chat not you" },
    { forms: ["!"], means: "excited", said: "excited excitement exciting thrilled hyped happy yay" },
    { forms: ["a"], means: "alterous", said: "alterous between platonic and romantic neither" },
    { forms: ["ao"], means: "an order", said: "order command telling you do this must" },
    { forms: ["av"], means: "a vent", said: "vent venting ranting letting it out complaining" },
    { forms: ["ay"], means: "at you", said: "at you aimed directed about you to you" },
    { forms: ["br"], means: "bragging", said: "brag bragging boasting showing off proud" },
    { forms: ["c"], means: "copypasta", said: "copypasta copied pasted copy paste meme text" },
    { forms: ["calm"], means: "calm", said: "calm calmly relaxed peaceful not worked up" },
    { forms: ["cb"], means: "clickbait", said: "clickbait bait exaggerated title" },
    { forms: ["cel"], means: "celebratory", said: "celebrate celebrating celebration congratulations congrats party" },
    { forms: ["co", "cf"], means: "comforting", said: "comfort comforting reassuring reassure consoling soothing there there" },
    { forms: ["curi"], means: "curious", said: "curious curiously curiosity interested wondering" },
    { forms: ["f"], means: "fake", said: "fake pretend pretending not real made up" },
    { forms: ["fam"], means: "familial", said: "family familial as family sibling parent relative love you" },
    { forms: ["fl"], means: "flirting", said: "flirt flirting flirty flirtatious hitting on" },
    { forms: ["fx"], means: "flex", said: "flex flexing showing off boast" },
    { forms: ["gentle"], means: "gentle", said: "gentle gently soft softly kind careful" },
    { forms: ["gs", "gens"], means: "genuine suggestion", said: "genuine suggestion suggest suggesting real advice idea recommend" },
    { forms: ["hyp"], means: "hyperbole", said: "hyperbole exaggerating exaggeration exaggerate overstating not literally" },
    { forms: ["info"], means: "informing", said: "info information informing fyi letting you know for your" },
    { forms: ["irre"], means: "irrelevant", said: "irrelevant does not matter beside the point" },
    { forms: ["jk"], means: "just kidding", said: "just kidding joking joke only" },
    { forms: ["jw"], means: "just wondering", said: "just wondering curious asking no reason" },
    { forms: ["l", "ly", "lyr"], means: "lyrics", said: "lyrics lyric song singing from a song words" },
    { forms: ["li"], means: "literally", said: "literal literally actually really not exaggerating exactly" },
    { forms: ["lu"], means: "a little upset", said: "little upset bit slightly sad bothered hurt" },
    { forms: ["m"], means: "metaphorically", said: "metaphor metaphorical metaphorically figure of speech not literally figuratively" },
    { forms: ["nabr"], means: "not a brag", said: "not a brag bragging boasting showing off" },
    { forms: ["nafx"], means: "not a flex", said: "not a flex flexing showing off" },
    { forms: ["nao"], means: "not an order", said: "not an order command do not have to optional no need" },
    { forms: ["naq"], means: "not a question", said: "not a question asking statement" },
    { forms: ["nav"], means: "not a vent", said: "not a vent venting ranting complaining" },
    { forms: ["nay"], means: "not at you", said: "not at you aimed directed about not you" },
    { forms: ["nbr"], means: "not being rude", said: "not rude being mean impolite no offence offense disrespect" },
    { forms: ["neu"], means: "neutral connotation", said: "neutral neither good nor bad no judgement" },
    { forms: ["nf"], means: "not fake", said: "not fake real true actually happened" },
    { forms: ["nfl"], means: "not flirting", said: "not flirting flirt flirty hitting on" },
    { forms: ["nmay"], means: "not mad at you", said: "not mad at you angry annoyed with you cross upset with you" },
    { forms: ["npa"], means: "not passive aggressive", said: "not passive aggressive snippy" },
    { forms: ["nsb"], means: "not subtweeting", said: "not subtweeting subtweet not about someone without naming vague" },
    { forms: ["nsrs"], means: "not serious", said: "not serious unserious joking do not take this seriously" },
    { forms: ["nsx", "nx"], means: "not sexual", said: "not sexual nonsexual non sexual innocent not like that" },
    { forms: ["ny"], means: "not yelling", said: "not yelling shouting caps loud screaming" },
    { forms: ["ot"], means: "off topic", said: "off topic unrelated change of subject different subject" },
    { forms: ["pa"], means: "passive aggressive", said: "passive aggressive snippy indirect annoyed" },
    { forms: ["para"], means: "paraphrase", said: "paraphrase paraphrasing roughly in other words not exact quote" },
    { forms: ["pf"], means: "playful", said: "playful playfully fun silly messing around" },
    { forms: ["qp"], means: "queerplatonic", said: "queerplatonic qpr partner more than friends not romantic" },
    { forms: ["r"], means: "romantic", said: "romantic romantically love you in love crush dating" },
    { forms: ["sbh"], means: "somebody here", said: "somebody someone here about a person in this chat" },
    { forms: ["sbtw"], means: "subtweeting", said: "subtweet subtweeting about someone without naming vague post" },
    { forms: ["st", "state"], means: "statement", said: "statement stating not a question saying fact" },
    { forms: ["tan"], means: "tangent", said: "tangent sidetrack sidetracked aside by the way wandering off" },
    { forms: ["th"], means: "threat", said: "threat threatening threaten warning" },
    { forms: ["tic"], means: "a tic", said: "tic tics typed without meaning to involuntary tourette" },
    { forms: ["ts"], means: "to self", said: "to self talking to myself note to self thinking aloud" },
    { forms: ["u"], means: "upset", said: "upset sad hurt bothered unhappy" },
    { forms: ["unin"], means: "unintentional", said: "unintentional unintended accident accidental did not mean to by mistake" },
    { forms: ["unre"], means: "unrelated", said: "unrelated nothing to do with separate different" },
    { forms: ["vu"], means: "very upset", said: "very upset really sad hurt a lot distressed" },
    { forms: ["w"], means: "warm", said: "warm warmth warmly affection affectionate fond caring" },
];

/** What was typed, made ready to look for: small letters, no slash in front, one space between words. */
export const tidy = (typed: string): string => typed.toLowerCase().replace(/^\s*\/+/, "").replace(/\s+/g, " ").trim();

/** Words too common to say anything about which tag is meant. */
const EMPTY = new Set(["a", "an", "the", "i", "im", "is", "it", "its", "this", "that", "to", "of", "in", "am", "are", "was", "be", "and", "or", "so", "but", "my", "me", "do", "does", "dont", "as", "for", "with", "on"]);
/** Words that count for a little: they tell tags apart ("not mad" from "mad") but are in many of them. */
const SLIGHT = new Set(["not", "you", "here", "just", "no", "at", "very", "little", "real", "really"]);

/** A word brought to its stem, roughly: "joking", "jokes" and "joked" all become "jok". */
export function stem(word: string): string {
    const bare = word.replace(/[^a-z!]/g, "");
    if (bare.length <= 4) return bare;
    return bare.replace(/(ingly|edly|ing|ed|ly|es|s|e)$/, "");
}

/** What was typed, as the stems of its words, with the empty ones left out. */
export const words = (typed: string): string[] =>
    tidy(typed)
        // "didn't" is "did not", so that it finds what "not" finds
        .replace(/n['\u2019]t\b/g, " not")
        .replace(/['’]/g, "")
        .split(/[^a-z!]+/)
        .filter((word) => word && !EMPTY.has(word))
        .map(stem);

const stems = new Map<Tag, Set<string>>();
/** The stems a tag is found by: those of its meaning and of the words written beside it. */
const known = (tag: Tag): Set<string> => {
    let mine = stems.get(tag);
    if (!mine) stems.set(tag, (mine = new Set(words(`${tag.means} ${tag.said}`))));
    return mine;
};

/**
 * How well a tag answers what was typed, 0 for not at all. The tag itself ("j", "/srs") scores 100;
 * a tag that begins with what was typed, 50. Otherwise it is how much of what was typed is among
 * the tag's own words, from 0 to 10, a word that says little counting for less; and a tag is not
 * found by such words alone. Typed with a slash, only the tags themselves are looked through.
 * Nothing typed matches everything.
 */
export function match(tag: Tag, typed: string): number {
    const wanted = tidy(typed);
    if (!wanted) return 1;
    if (tag.forms.includes(wanted)) return 100;
    if (!wanted.includes(" ") && tag.forms.some((form) => form.startsWith(wanted))) return 50;
    if (/^\s*\//.test(typed)) return 0;
    const asked = words(typed);
    if (asked.length === 0) return 0;
    const mine = known(tag);
    let found = 0;
    let all = 0;
    let telling = false;
    asked.forEach((word, place) => {
        const weight = SLIGHT.has(word) ? 0.4 : 1;
        all += weight;
        // the word being typed now may be unfinished: it finds what begins with it
        const last = place === asked.length - 1;
        const has = mine.has(word) || (last && word.length > 1 && [...mine].some((each) => each.startsWith(word)));
        if (!has) return;
        found += weight;
        if (weight === 1) telling = true;
    });
    // words that say little find a tag only when nothing else was typed
    if (!telling && asked.some((word) => !SLIGHT.has(word))) return 0;
    return found === 0 ? 0 : (10 * found) / all;
}

/** The tags that answer what was typed, the closest first, leaving out those that answer far less well than the best. */
export function find(typed: string): Tag[] {
    const scored = tags.map((tag, place) => ({ tag, place, score: match(tag, typed) })).filter((each) => each.score > 0);
    const best = Math.max(0, ...scored.map((each) => each.score));
    // by its letters, every tag that begins with them is wanted; by meaning, only those near the best
    const enough = best >= 50 ? 50 : best * 0.6;
    return scored
        .filter((each) => each.score >= enough)
        .sort((a, b) => b.score - a.score || a.place - b.place)
        .map((each) => each.tag);
}

/** The tag named after # in an address ("#srs", "#%2Fsrs"), lower case and without its slash. A hash that is not well formed is read as it is, not thrown over. */
export function named(hash: string): string {
    const raw = hash.replace(/^#/, "");
    let read = raw;
    try {
        read = decodeURIComponent(raw);
    } catch {
        // "#%" and the like: no tag is written that way, so the raw text finds none
    }
    return read.toLowerCase().replace(/^\//, "");
}
