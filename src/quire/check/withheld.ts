// Words spelling never offers as a suggestion: slurs for race, ethnicity, sexuality, gender and
// disability, and explicit sexual and vulgar words. They stay in the dictionary, so a writer who
// types one on purpose is not told it is misspelt; they are only never put forward in place of a
// slip, where a near miss of an ordinary word ("comming", "dilaog") could otherwise offer one.
// Taken from the words the dictionary holds. Words that also have an ordinary meaning a slip is
// likely to have been aiming at (spade, cracker, fairy, fruit, tart, queer) are left out on purpose.

/** Every word withheld, in small letters. */
export const WITHHELD: ReadonlySet<string> = new Set([
    // race and ethnicity
    "nigger", "niggers", "nigga", "niggas", "negro", "coon", "coons", "darkie", "darkies", "wog", "wogs", "golliwog", "golliwogs", "chink", "chinks", "gook", "gooks", "coolie", "coolies", "spic", "spics", "wetback", "wetbacks", "greaser", "greasers", "dago", "dagos", "dagoes", "wop", "wops", "kike", "kikes", "yid", "yids", "sheeny", "camel-jockey", "redskin", "redskins", "squaw", "squaws", "half-breed", "half-breeds", "gyp", "gypped", "gyps", "gypsy", "gypsies", "honky", "honkies", "whitey", "whiteys", "kraut", "krauts", "mick", "micks", "limey", "limeys", "mulatto", "mulattoes",
    // sexuality and gender
    "faggot", "faggots", "fag", "fags", "poof", "poofs", "pouf", "poofter", "poofters", "homo", "homos", "dyke", "dykes", "sodomite", "sodomites", "bugger", "buggers", "pansy", "pansies", "fruitcake", "batty", "he-she", "transvestite",
    // disability
    "retard", "retards", "retarded", "mongoloid", "mongoloids", "spastic", "spastics", "cripple", "cripples", "gimp", "gimps", "imbecile", "imbeciles", "moron", "morons", "cretin", "cretins", "psycho", "psychos", "schizo", "schizos", "midget", "midgets",
    // women, as insults
    "bitch", "bitches", "cunt", "cunts", "twat", "twats", "whore", "whores", "slut", "sluts", "harlot",
    // explicit and vulgar
    "fuck", "fucked", "fucker", "fuckers", "fucking", "fucks", "motherfucker", "motherfuckers", "shit", "shits", "shitty", "cock", "cocks", "cocksucker", "cocksuckers", "dick", "dicks", "dickhead", "pussy", "pussies", "tits", "titties", "titty", "boobs", "boobies", "wank", "wanker", "wankers", "wanking", "cum", "cumming", "cums", "spunk", "dildo", "dildos", "blowjob", "blowjobs", "fellatio", "cunnilingus", "anal", "arse", "arsehole", "asshole", "assholes", "ass", "asses", "porn", "porno", "pornography", "pornographic", "orgasm", "orgasms", "orgy", "orgies", "masturbate", "masturbated", "masturbating", "masturbation", "ejaculate", "ejaculated", "ejaculation", "clit", "horny", "threesome",
    // sexual violence
    "rape", "raped", "rapes", "rapist", "rapists", "molest", "molester", "paedophile", "pedophile", "paedophiles", "pedophiles",
]);

/** True for a suggestion that is never offered: a withheld word, or two words run apart where either is one. */
export function withheld(suggestion: string): boolean {
    return suggestion.toLowerCase().split(" ").some((part) => WITHHELD.has(part));
}
