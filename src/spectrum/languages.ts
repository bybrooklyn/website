// The words of Spectrum in its five languages, and which one a page is in. The wording and the
// translations are Andrea Vos's Spectrum's and its translators' (see LICENSE.md), without the two
// sliders taken out. A language that lacks a word uses the English one.

import { HIGHEST, LOWEST, MIDDLE, type Axis } from "./axes";

/** A slider's name, and the words at its two ends and its middle. */
export interface Ends {
    label: string;
    farLeft: string;
    middle: string;
    farRight: string;
}

export interface Language {
    /** What the language calls itself, for the picker. */
    name: string;
    rtl?: boolean;
    title: string;
    question: string;
    /** Over the share link. */
    share?: string;
    copy?: string;
    copied?: string;
    /** On a slider that has been left unset, and on the button that does it. */
    unset?: string;
    /**
     * Where a slider is, for screen readers, with {n} its position, {all} how many there are, {at}
     * the word it is on, {a} and {b} the words it is between and {near} the nearer of them.
     */
    on?: string;
    between?: string;
    halfway?: string;
    /** Who translated it, with words before the name. */
    translator?: { said: string; name: string; link?: string };
    axes: Partial<Record<Axis, Ends>>;
}

const en: Language = {
    name: "English",
    title: "Gender & Sexuality Spectrum",
    question: "Where are you on the Gender & Sexuality Spectrum?",
    share: "Share yours",
    copy: "Copy link",
    copied: "Copied",
    unset: "Not set",
    on: "{n} of {all}, {at}",
    between: "{n} of {all}, between {a} and {b}, nearer {near}",
    halfway: "{n} of {all}, halfway between {a} and {b}",
    axes: {
        genderIdentity: { label: "Gender identity", farLeft: "Man", middle: "Nonbinary", farRight: "Woman" },
        genderExpression: { label: "Gender expression", farLeft: "Hypermasculine", middle: "Androgynous", farRight: "Hyperfeminine" },
        sexualOrientation: { label: "Sexual orientation", farLeft: "Straight", middle: "Bisexual/Pansexual", farRight: "Gay/Lesbian" },
        romanticOrientation: { label: "Romantic orientation", farLeft: "Heteroromantic", middle: "Biromantic/Panromantic", farRight: "Homoromantic" },
        sexualAttraction: { label: "Sexual attraction", farLeft: "None", middle: "Moderate", farRight: "Very high" },
        sexualDrive: { label: "Sexual drive (libido)", farLeft: "None", middle: "Regular", farRight: "Very high" },
        romanticDesire: { label: "Romantic desire", farLeft: "None", middle: "Regular", farRight: "Very high" },
        relationshipAttitude: { label: "Relationship attitude", farLeft: "Monogamous", middle: "Open", farRight: "Polyamorous" },
        genderComfort: { label: "Gender comfort", farLeft: "Strong dysphoria", middle: "Neutral", farRight: "Euphoric" },
    },
};

const pl: Language = {
    name: "Polski",
    title: "Spektrum Płci i Seksualności",
    question: "Gdzie znajdujesz się na Spektrum Płci i Seksualności?",
    share: "Udostępnij",
    copy: "Skopiuj do schowka",
    translator: { said: "Polskie tłumaczenie:", name: "Avis Drożniak", link: "https://zaimki.pl/@avis" },
    axes: {
        genderIdentity: { label: "Identyfikacja płciowa", farLeft: "Mężczyzna", middle: "Niebinarnie", farRight: "Kobieta" },
        genderExpression: { label: "Wyrażenie płci", farLeft: "Bardziej męskie", middle: "Androgyniczne", farRight: "Bardziej kobiece" },
        sexualOrientation: { label: "Orientacja seksualna", farLeft: "Hetero", middle: "Bi/Pan", farRight: "Gej/Lesbijka" },
        sexualDrive: { label: "Pociąg seksualny", farLeft: "Brak", middle: "Przeciętny", farRight: "Wysoki" },
        romanticDesire: { label: "Pociąg romantyczny", farLeft: "Brak", middle: "Przeciętny", farRight: "Wysoki" },
        relationshipAttitude: { label: "Postawa w związku", farLeft: "Monogamia", middle: "Otwarty", farRight: "Poliamoria" },
    },
};

const de: Language = {
    name: "Deutsch",
    title: "Geschlechtliches & Sexuelles Spektrum",
    question: "Wo befindest du dich auf dem Spektrum von Geschlecht und Sexualität?",
    share: "Teile deins",
    copy: "In die Zwischenablage kopieren",
    translator: { said: "Übersetzt von", name: "Feuerhamster", link: "https://gitlab.com/feuerhamster" },
    axes: {
        genderIdentity: { label: "Geschlechtliche Identität", farLeft: "Männlich", middle: "Nicht-Binär", farRight: "Weiblich" },
        genderExpression: { label: "Geschlechtlicher Ausdruck", farLeft: "Hyper-Maskulin", middle: "Androgyn", farRight: "Hyper-Feminin" },
        sexualOrientation: { label: "Sexuelle Orientierung", farLeft: "Heterosexuell", middle: "Bi/Pan", farRight: "Schwul/Lesbisch" },
        sexualDrive: { label: "Sexualtrieb", farLeft: "Kein", middle: "Regelmäßig", farRight: "Hoch" },
        romanticDesire: { label: "Romantische Wünsche", farLeft: "Keine", middle: "Regelmäßige", farRight: "Hohe" },
        relationshipAttitude: { label: "Beziehungstyp", farLeft: "Monogam", middle: "Offen", farRight: "Polyamourös" },
    },
};

const pt: Language = {
    name: "Português",
    title: "Espectro de Gênero e Sexualidade",
    question: "Onde você está no Espectro de Gênero e Sexualidade?",
    share: "Compartilhe o seu",
    copy: "Copiar para a área de transferência",
    translator: { said: "Traduzido por", name: "Diogo de Souza", link: "https://gitlab.com/sozua" },
    axes: {
        genderIdentity: { label: "Identidade de Gênero", farLeft: "Homem", middle: "Não-binário", farRight: "Mulher" },
        genderExpression: { label: "Expressão de Gênero", farLeft: "Hipermasculino", middle: "Andrógino", farRight: "Hiperfeminino" },
        sexualOrientation: { label: "Orientação Sexual", farLeft: "Heterossexual", middle: "Bi/Pan", farRight: "Gay/Lésbica" },
        sexualDrive: { label: "Desejo Sexual", farLeft: "Nenhum", middle: "Regular", farRight: "Alto" },
        romanticDesire: { label: "Desejo Romântico", farLeft: "Nenhum", middle: "Regular", farRight: "Alto" },
        relationshipAttitude: { label: "Atitude em relação ao relacionamento", farLeft: "Monogâmico", middle: "Aberto", farRight: "Poliamoroso" },
    },
};

const ar: Language = {
    name: "العربية",
    rtl: true,
    title: "الطيف الجنسي",
    question: "أين أنت على الطيف الجنسي؟",
    share: "المشاركة",
    copy: "نسخ الرابط",
    translator: { said: "مُترجَمة من قِبَل", name: "متطوع" },
    axes: {
        genderIdentity: { label: "الهوية الجنسية", farLeft: "ذكر", middle: "غير ثنائي", farRight: "أنثى" },
        genderExpression: { label: "التعبير الجنسي", farLeft: "فرط ذكوري", middle: "ما بين", farRight: "فرط أنثوي" },
        sexualOrientation: { label: "التوجه الجنسي", farLeft: "محب للجنس الآخر", middle: "ثنائي/بان", farRight: "مثلي/مثلية الجنس" },
        sexualDrive: { label: "الرغبة الجنسية", farLeft: "غير موجودة", middle: "متوسطة", farRight: "عالية" },
        romanticDesire: { label: "الرغبة الرومانسية", farLeft: "غير موجودة", middle: "متوسطة", farRight: "عالية" },
        relationshipAttitude: { label: "موقف العلاقة", farLeft: "أحادية", middle: "منفتحة", farRight: "متعددة" },
    },
};

/** The languages by their codes, in the picker's order. */
export const languages = { en, pl, de, ar, pt } as const;

export type Code = keyof typeof languages;

export const codes = Object.keys(languages) as Code[];

/** The language for a `?l=` value: a known code, or its first part (`pt-BR` is `pt`), and English otherwise. */
export function pick(asked: string | null | undefined): Code {
    const code = (asked ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
    return codes.includes(code as Code) ? (code as Code) : "en";
}

/** Every word a page needs, in one language, with English for any it lacks. */
export type Words = Required<Omit<Language, "translator">> & Pick<Language, "translator"> & { axes: Record<Axis, Ends> };

export function words(code: Code): Words {
    const own = languages[code];
    return {
        ...en,
        ...own,
        rtl: Boolean(own.rtl),
        axes: { ...en.axes, ...own.axes } as Record<Axis, Ends>,
    } as Words;
}

/**
 * Where a slider is, for screen readers, from its number and the words at its ends and middle:
 * "7 of 17, between Man and Nonbinary, nearer Nonbinary". The words are at 1, 9 and 17.
 */
export function said(words: Words, axis: Axis, value: number): string {
    const ends = words.axes[axis];
    if (!(value >= LOWEST && value <= HIGHEST)) return words.unset;
    const fill = (template: string, parts: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, name: string) => parts[name] ?? "");
    const n = String(value);
    const all = String(HIGHEST);
    const marks: [number, string][] = [
        [LOWEST, ends.farLeft],
        [MIDDLE, ends.middle],
        [HIGHEST, ends.farRight],
    ];
    const on = marks.find(([at]) => at === value);
    if (on) return fill(words.on, { n, all, at: on[1] });
    const [[low, a], [high, b]] = value < MIDDLE ? [marks[0]!, marks[1]!] : [marks[1]!, marks[2]!];
    if (value - low === high - value) return fill(words.halfway, { n, all, a, b });
    return fill(words.between, { n, all, a, b, near: value - low < high - value ? a : b });
}

/** Words that may break after a slash, so "Bisexual/Pansexual" wraps there on a narrow screen and not inside a word. */
export const breakable = (text: string): string => text.replace(/\//g, "/​");

/** The address of the page with this code, in this language. `l` is left out for English, and `c` when there is no code yet. */
export function address(code: string | undefined, language: Code): string {
    const query = [code && `c=${code}`, language !== "en" && `l=${language}`].filter(Boolean).join("&");
    return `/spectrum/${query ? `?${query}` : ""}`;
}
