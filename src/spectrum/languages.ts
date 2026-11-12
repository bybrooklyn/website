// The words of Spectrum in its five languages, and which one a page is in. The wording and the
// translations are Andrea Vos's Spectrum's and its translators' (see LICENSE.md), without the two
// sliders taken out. A language that lacks a word uses the English one.

import { type Axis } from "./axes";

/** A slider's name, and the words for its two ends, its middle, and the steps between. */
export interface Ends {
    label: string;
    farLeft: string;
    left: string;
    middle: string;
    right: string;
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
    /** The chart's name, the line under it, and what it says with nothing set. */
    chart?: string;
    hint?: string;
    empty?: string;
    /** Who translated it, with words before the name. */
    translator?: { said: string; name: string; link?: string };
    axes: Partial<Record<Axis, Ends>>;
    /** The names of the chart's corners, by the keys in `groups`. */
    corners: Partial<Record<string, string>>;
}

const en: Language = {
    name: "English",
    title: "Gender & Sexuality Spectrum",
    question: "Where are you on the Gender & Sexuality Spectrum?",
    share: "Share yours",
    copy: "Copy link",
    copied: "Copied",
    unset: "Not set",
    chart: "Overview",
    hint: "Average of each group’s set axes (1–9); unset axes are excluded.",
    empty: "Set at least one slider to see your chart.",
    axes: {
        genderIdentity: { label: "Gender identity", farLeft: "Man", left: "Mostly man", middle: "Nonbinary", right: "Mostly woman", farRight: "Woman" },
        genderExpression: { label: "Gender expression", farLeft: "Hypermasculine", left: "Masculine", middle: "Androgynous", right: "Feminine", farRight: "Hyperfeminine" },
        sexualOrientation: { label: "Sexual orientation", farLeft: "Straight", left: "Mostly straight", middle: "Bisexual/Pansexual", right: "Mostly gay/lesbian", farRight: "Gay/Lesbian" },
        romanticOrientation: { label: "Romantic orientation", farLeft: "Heteroromantic", left: "Mostly heteroromantic", middle: "Biromantic/Panromantic", right: "Mostly homoromantic", farRight: "Homoromantic" },
        sexualAttraction: { label: "Sexual attraction", farLeft: "None", left: "Low", middle: "Moderate", right: "High", farRight: "Very high" },
        sexualDrive: { label: "Sexual drive (libido)", farLeft: "None", left: "Low", middle: "Regular", right: "High", farRight: "Very high" },
        romanticDesire: { label: "Romantic desire", farLeft: "None", left: "Low", middle: "Regular", right: "High", farRight: "Very high" },
        relationshipAttitude: { label: "Relationship attitude", farLeft: "Monogamous", left: "Mostly monogamous", middle: "Open", right: "Mostly polyamorous", farRight: "Polyamorous" },
        genderComfort: { label: "Gender comfort", farLeft: "Strong dysphoria", left: "Mild dysphoria", middle: "Neutral", right: "Comfortable", farRight: "Euphoric" },
    },
    corners: { genderSelf: "Gender self", expression: "Expression", orientation: "Orientation", desire: "Desire", relationships: "Relationships" },
};

const pl: Language = {
    name: "Polski",
    title: "Spektrum Płci i Seksualności",
    question: "Gdzie znajdujesz się na Spektrum Płci i Seksualności?",
    share: "Udostępnij",
    copy: "Skopiuj do schowka",
    chart: "Przegląd",
    translator: { said: "Polskie tłumaczenie:", name: "Avis Drożniak", link: "https://zaimki.pl/@avis" },
    axes: {
        genderIdentity: { label: "Identyfikacja płciowa", farLeft: "Mężczyzna", left: "Mężczyzna", middle: "Niebinarnie", right: "Kobieta", farRight: "Kobieta" },
        genderExpression: { label: "Wyrażenie płci", farLeft: "Bardziej męskie", left: "Bardziej męskie", middle: "Androgyniczne", right: "Bardziej kobiece", farRight: "Bardziej kobiece" },
        sexualOrientation: { label: "Orientacja seksualna", farLeft: "Hetero", left: "Hetero", middle: "Bi/Pan", right: "Przeważnie homo", farRight: "Gej/Lesbijka" },
        sexualDrive: { label: "Pociąg seksualny", farLeft: "Brak", left: "Brak", middle: "Przeciętny", right: "Wysoki", farRight: "Wysoki" },
        romanticDesire: { label: "Pociąg romantyczny", farLeft: "Brak", left: "Brak", middle: "Przeciętny", right: "Wysoki", farRight: "Wysoki" },
        relationshipAttitude: { label: "Postawa w związku", farLeft: "Monogamia", left: "Monogamia", middle: "Otwarty", right: "Poliamoria", farRight: "Poliamoria" },
    },
    corners: { genderSelf: "Płeć", expression: "Ekspresja", orientation: "Orientacja", desire: "Pożądanie", relationships: "Relacje" },
};

const de: Language = {
    name: "Deutsch",
    title: "Geschlechtliches & Sexuelles Spektrum",
    question: "Wo befindest du dich auf dem Spektrum von Geschlecht und Sexualität?",
    share: "Teile deins",
    copy: "In die Zwischenablage kopieren",
    chart: "Überblick",
    translator: { said: "Übersetzt von", name: "Feuerhamster", link: "https://gitlab.com/feuerhamster" },
    axes: {
        genderIdentity: { label: "Geschlechtliche Identität", farLeft: "Männlich", left: "Männlich", middle: "Nicht-Binär", right: "Weiblich", farRight: "Weiblich" },
        genderExpression: { label: "Geschlechtlicher Ausdruck", farLeft: "Hyper-Maskulin", left: "Hyper-Maskulin", middle: "Androgyn", right: "Hyper-Feminin", farRight: "Hyper-Feminin" },
        sexualOrientation: { label: "Sexuelle Orientierung", farLeft: "Heterosexuell", left: "Heterosexuell", middle: "Bi/Pan", right: "Überwiegend homosexuell", farRight: "Schwul/Lesbisch" },
        sexualDrive: { label: "Sexualtrieb", farLeft: "Kein", left: "Kein", middle: "Regelmäßig", right: "Hoch", farRight: "Hoch" },
        romanticDesire: { label: "Romantische Wünsche", farLeft: "Keine", left: "Keine", middle: "Regelmäßige", right: "Hohe", farRight: "Hohe" },
        relationshipAttitude: { label: "Beziehungstyp", farLeft: "Monogam", left: "Monogam", middle: "Offen", right: "Polyamourös", farRight: "Polyamourös" },
    },
    corners: { genderSelf: "Geschlecht", expression: "Ausdruck", orientation: "Orientierung", desire: "Verlangen", relationships: "Beziehungen" },
};

const pt: Language = {
    name: "Português",
    title: "Espectro de Gênero e Sexualidade",
    question: "Onde você está no Espectro de Gênero e Sexualidade?",
    share: "Compartilhe o seu",
    copy: "Copiar para a área de transferência",
    chart: "Resumo",
    translator: { said: "Traduzido por", name: "Diogo de Souza", link: "https://gitlab.com/sozua" },
    axes: {
        genderIdentity: { label: "Identidade de Gênero", farLeft: "Homem", left: "Homem", middle: "Não-binário", right: "Mulher", farRight: "Mulher" },
        genderExpression: { label: "Expressão de Gênero", farLeft: "Hipermasculino", left: "Hipermasculino", middle: "Andrógino", right: "Hiperfeminino", farRight: "Hiperfeminino" },
        sexualOrientation: { label: "Orientação Sexual", farLeft: "Heterossexual", left: "Heterossexual", middle: "Bi/Pan", right: "Majoritariamente gay", farRight: "Gay/Lésbica" },
        sexualDrive: { label: "Desejo Sexual", farLeft: "Nenhum", left: "Nenhum", middle: "Regular", right: "Alto", farRight: "Alto" },
        romanticDesire: { label: "Desejo Romântico", farLeft: "Nenhum", left: "Nenhum", middle: "Regular", right: "Alto", farRight: "Alto" },
        relationshipAttitude: { label: "Atitude em relação ao relacionamento", farLeft: "Monogâmico", left: "Monogâmico", middle: "Aberto", right: "Poliamoroso", farRight: "Poliamoroso" },
    },
    corners: { genderSelf: "Gênero", expression: "Expressão", orientation: "Orientação", desire: "Desejo", relationships: "Relações" },
};

const ar: Language = {
    name: "العربية",
    rtl: true,
    title: "الطيف الجنسي",
    question: "أين أنت على الطيف الجنسي؟",
    share: "المشاركة",
    copy: "نسخ الرابط",
    chart: "نظرة عامة",
    translator: { said: "مُترجَمة من قِبَل", name: "متطوع" },
    axes: {
        genderIdentity: { label: "الهوية الجنسية", farLeft: "ذكر", left: "ذكر", middle: "غير ثنائي", right: "أنثى", farRight: "أنثى" },
        genderExpression: { label: "التعبير الجنسي", farLeft: "فرط ذكوري", left: "فرط ذكوري", middle: "ما بين", right: "فرط أنثوي", farRight: "فرط أنثوي" },
        sexualOrientation: { label: "التوجه الجنسي", farLeft: "محب للجنس الآخر", left: "محب للجنس الآخر", middle: "ثنائي/بان", right: "مثلي الجنس غالبًا", farRight: "مثلي/مثلية الجنس" },
        sexualDrive: { label: "الرغبة الجنسية", farLeft: "غير موجودة", left: "غير موجودة", middle: "متوسطة", right: "عالية", farRight: "عالية" },
        romanticDesire: { label: "الرغبة الرومانسية", farLeft: "غير موجودة", left: "غير موجودة", middle: "متوسطة", right: "عالية", farRight: "عالية" },
        relationshipAttitude: { label: "موقف العلاقة", farLeft: "أحادية", left: "أحادية", middle: "منفتحة", right: "متعددة", farRight: "متعددة" },
    },
    corners: { genderSelf: "الهوية", expression: "التعبير", orientation: "التوجه", desire: "الرغبة", relationships: "العلاقات" },
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
export type Words = Required<Omit<Language, "translator">> & Pick<Language, "translator"> & { axes: Record<Axis, Ends>; corners: Record<string, string> };

export function words(code: Code): Words {
    const own = languages[code];
    return {
        ...en,
        ...own,
        rtl: Boolean(own.rtl),
        axes: { ...en.axes, ...own.axes } as Record<Axis, Ends>,
        corners: { ...en.corners, ...own.corners } as Record<string, string>,
    } as Words;
}

/** The words for where a slider is, for screen readers: the nearest of its five, or unset. */
export function said(words: Words, axis: Axis, value: number): string {
    const ends = words.axes[axis];
    if (!(value >= 1 && value <= 9)) return words.unset;
    if (value <= 2) return ends.farLeft;
    if (value <= 4) return ends.left;
    if (value === 5) return ends.middle;
    if (value <= 7) return ends.right;
    return ends.farRight;
}

/** Words that may break after a slash, so "Bisexual/Pansexual" wraps there on a narrow screen and not inside a word. */
export const breakable = (text: string): string => text.replace(/\//g, "/​");

/** The address of the page with this code, in this language. `l` is left out for English, and `c` when there is no code yet. */
export function address(code: string | undefined, language: Code): string {
    const query = [code && `c=${code}`, language !== "en" && `l=${language}`].filter(Boolean).join("&");
    return `/spectrum/${query ? `?${query}` : ""}`;
}
