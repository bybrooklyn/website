// Code highlighting, written here: a small tokenizer for each language the site's posts and her
// projects use. Each language is a list of patterns tried in order at every place in the code; the
// first that matches there gives the next token, and a character no pattern takes is plain text.
// The pieces always join back into the code exactly, so the surface can draw them as the text
// itself. It is a highlighter for reading, not a parser: a keyword is a word in the list, a function
// is a word before a bracket. The colors are the site's (src/styles/quire-markdown.css).

/** What a piece of code is, which is what colors it. */
export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "constant" | "function" | "type" | "operator" | "punctuation" | "tag" | "attribute" | "property" | "variable" | "heading" | "emphasis" | "inserted" | "deleted";

/** A piece of code and what it is. */
export interface Token {
    kind: TokenKind;
    text: string;
}

type Rule = [RegExp, TokenKind | ((match: string, code: string, at: number) => TokenKind)];

/** A language: its name, what a writer may call it after the fence, and its patterns. */
interface Language {
    name: string;
    label: string;
    aliases: string[];
    rules: Rule[];
}

const words = (list: string) => new Set(list.split(" "));

/** A rule for words: keywords, constants and types from lists, a word before `(` as a function, and a capital as a type. */
function wordRule(keywords: Set<string>, constants: Set<string>, types = new Set<string>(), capitals = true): Rule {
    return [
        /[A-Za-z_$][\w$]*/y,
        (word, code, at) => {
            if (keywords.has(word)) return "keyword";
            if (constants.has(word)) return "constant";
            if (types.has(word)) return "type";
            let next = at + word.length;
            while (code[next] === " ") next++;
            if (code[next] === "(") return "function";
            if (capitals && /^[A-Z][a-z0-9]/.test(word)) return "type";
            return "plain";
        },
    ];
}

const NUMBER: Rule = [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z]*/y, "number"];
const SLASH_COMMENT: Rule = [/\/\/.*/y, "comment"];
const BLOCK_COMMENT: Rule = [/\/\*[\s\S]*?(?:\*\/|$)/y, "comment"];
const HASH_COMMENT: Rule = [/#.*/y, "comment"];
const DOUBLE: Rule = [/"(?:[^"\\\n]|\\.)*"?/y, "string"];
const SINGLE: Rule = [/'(?:[^'\\\n]|\\.)*'?/y, "string"];
const OPERATOR: Rule = [/[+\-*/%=<>!&|^~?:]+/y, "operator"];
const PUNCTUATION: Rule = [/[{}()[\];,.@]/y, "punctuation"];

const JS_KEYWORDS = words("break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as interface type enum implements namespace declare readonly private protected public abstract keyof satisfies infer is get set");
const JS_CONSTANTS = words("true false null undefined NaN Infinity");
const JS_TYPES = words("string number boolean any unknown never void object bigint symbol");

const javascript: Rule[] = [SLASH_COMMENT, BLOCK_COMMENT, [/`(?:[^`\\]|\\[\s\S])*`?/y, "string"], DOUBLE, SINGLE, NUMBER, wordRule(JS_KEYWORDS, JS_CONSTANTS, JS_TYPES), [/=>|[+\-*/%=<>!&|^~?:]+/y, "operator"], PUNCTUATION];

const rust: Rule[] = [
    SLASH_COMMENT,
    BLOCK_COMMENT,
    [/b?r#*"[\s\S]*?"#*/y, "string"],
    DOUBLE,
    [/'(?:[^'\\\n]|\\.)'/y, "string"],
    [/'[a-z_]\w*/y, "type"],
    [/[a-z_]\w*!/y, "function"],
    [/#!?\[[^\]\n]*\]/y, "attribute"],
    NUMBER,
    wordRule(words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"), words("true false None Some Ok Err"), words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box")),
    OPERATOR,
    PUNCTUATION,
];

const go: Rule[] = [
    SLASH_COMMENT,
    BLOCK_COMMENT,
    [/`[^`]*`?/y, "string"],
    DOUBLE,
    [/'(?:[^'\\\n]|\\.)*'/y, "string"],
    NUMBER,
    wordRule(words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"), words("true false nil iota"), words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any")),
    OPERATOR,
    PUNCTUATION,
];

const python: Rule[] = [
    HASH_COMMENT,
    [/[rbfuRBFU]{0,2}("""|''')[\s\S]*?(?:\1|$)/y, "string"],
    [/[rbfuRBFU]{0,2}"(?:[^"\\\n]|\\.)*"?/y, "string"],
    [/[rbfuRBFU]{0,2}'(?:[^'\\\n]|\\.)*'?/y, "string"],
    [/@[\w.]+/y, "attribute"],
    NUMBER,
    wordRule(words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"), words("True False None self cls"), words("int float str bool list dict set tuple bytes object")),
    OPERATOR,
    PUNCTUATION,
];

const shell: Rule[] = [
    [/(?<=^|[\s;])#.*/my, "comment"],
    DOUBLE,
    [/'[^']*'?/y, "string"],
    [/\$(?:\{[^}\n]*\}?|\w+|[@*#?$!0-9-])/y, "variable"],
    [/(?<=^|\s)--?[\w-]+/y, "attribute"],
    [/\d+(?![\w-])/y, "number"],
    [/[A-Za-z_][\w-]*(?==)/y, "variable"],
    [/[A-Za-z_./~][\w./~-]*/y, (word, code, at) => (SHELL_KEYWORDS.has(word) ? "keyword" : commandStart(code, at) ? "function" : "plain")],
    [/[|&;<>]+|\$\(|[()]/y, "operator"],
];
const SHELL_KEYWORDS = words("if then else elif fi for while until do done case esac in function select return export local readonly unset break continue source alias sudo");

/** True if a word stands where a shell command starts: at a line's start or after a pipe, `;`, `&&` or `$(`. */
function commandStart(code: string, at: number): boolean {
    let index = at - 1;
    while (index >= 0 && (code[index] === " " || code[index] === "\t")) index--;
    if (index < 0 || code[index] === "\n") return true;
    if ("|;&(".includes(code[index]!)) return true;
    // after `sudo` or a keyword, the next word is a command too
    const before = /([\w-]+)$/.exec(code.slice(Math.max(0, index - 20), index + 1))?.[1];
    return !!before && (before === "sudo" || before === "then" || before === "do" || before === "else" || before === "time");
}

const json: Rule[] = [
    SLASH_COMMENT,
    [/"(?:[^"\\\n]|\\.)*"?(?=\s*:)/y, "property"],
    DOUBLE,
    NUMBER,
    [/\b(?:true|false|null)\b/y, "constant"],
    PUNCTUATION,
    [/:/y, "punctuation"],
];

const css: Rule[] = [
    BLOCK_COMMENT,
    DOUBLE,
    SINGLE,
    [/@[\w-]+/y, "keyword"],
    [/#[\da-fA-F]{3,8}\b/y, "number"],
    [/--[\w-]+/y, "variable"],
    [/[\w-]+(?=\s*:(?!:)[^{;]*[;}\n])/y, "property"],
    [/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?/y, "number"],
    [/[.#][\w-]+/y, "tag"],
    [/::?[\w-]+/y, "attribute"],
    [/[\w-]+(?=\()/y, "function"],
    [/!important\b/y, "keyword"],
    [/[\w-]+/y, "plain"],
    [/[{}();,:>+~*]/y, "punctuation"],
];

const html: Rule[] = [
    [/<!--[\s\S]*?(?:-->|$)/y, "comment"],
    [/<\/?[A-Za-z][\w.:-]*/y, "tag"],
    [/\/?>/y, "tag"],
    [/[A-Za-z_:@][\w:.-]*(?==)/y, "attribute"],
    DOUBLE,
    SINGLE,
    [/\{[^{}\n]*\}/y, "variable"],
    [/&[#\w]+;/y, "constant"],
];

const markdown: Rule[] = [
    [/^#{1,6}[ \t].*/my, "heading"],
    [/^(?:```|~~~).*/my, "comment"],
    [/`[^`\n]+`/y, "string"],
    [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, "keyword"],
    [/\*[^*\n]+\*|_[^_\n]+_/y, "emphasis"],
    [/!?\[[^\]\n]*\]\([^)\n]*\)/y, "attribute"],
    [/^[ \t]*(?:[-*+]|\d+[.)])(?=[ \t])/my, "punctuation"],
    [/^[ \t]*>/my, "punctuation"],
    [/<\/?[A-Za-z][^>\n]*>/y, "tag"],
];

const yaml: Rule[] = [
    HASH_COMMENT,
    [/^[ \t]*(?:- )?[\w.-]+(?=[ \t]*:(?:\s|$))/my, "property"],
    DOUBLE,
    SINGLE,
    [/\b(?:true|false|null|yes|no|on|off)\b/y, "constant"],
    [/-?\d[\d.]*\b/y, "number"],
    [/^---$/my, "punctuation"],
    [/[:\-[\]{},|>]/y, "punctuation"],
];

const toml: Rule[] = [HASH_COMMENT, [/^\s*\[\[?[^\]\n]*\]\]?/my, "tag"], [/^[ \t]*[\w.-]+(?=[ \t]*=)/my, "property"], [/"""[\s\S]*?(?:"""|$)/y, "string"], DOUBLE, SINGLE, [/\b(?:true|false)\b/y, "constant"], NUMBER, [/[=[\]{},]/y, "punctuation"]];

const diff: Rule[] = [
    [/^(?:\+\+\+|---).*/my, "heading"],
    [/^@@.*/my, "attribute"],
    [/^\+.*/my, "inserted"],
    [/^-.*/my, "deleted"],
];

/** Every language highlighted, with the names a fence may give it. */
export const LANGUAGES: Language[] = [
    { name: "typescript", label: "TypeScript", aliases: ["ts", "tsx", "typescript", "mts", "cts"], rules: javascript },
    { name: "javascript", label: "JavaScript", aliases: ["js", "jsx", "javascript", "mjs", "cjs"], rules: javascript },
    { name: "rust", label: "Rust", aliases: ["rs", "rust"], rules: rust },
    { name: "go", label: "Go", aliases: ["go", "golang"], rules: go },
    { name: "python", label: "Python", aliases: ["py", "python", "python3"], rules: python },
    { name: "shell", label: "Shell", aliases: ["sh", "bash", "zsh", "shell", "console", "shellscript", "fish"], rules: shell },
    { name: "json", label: "JSON", aliases: ["json", "jsonc", "json5"], rules: json },
    { name: "css", label: "CSS", aliases: ["css", "scss", "less"], rules: css },
    { name: "html", label: "HTML", aliases: ["html", "xml", "svg", "astro", "vue", "svelte"], rules: html },
    { name: "markdown", label: "Markdown", aliases: ["md", "markdown", "mdx"], rules: markdown },
    { name: "yaml", label: "YAML", aliases: ["yaml", "yml"], rules: yaml },
    { name: "toml", label: "TOML", aliases: ["toml"], rules: toml },
    { name: "diff", label: "Diff", aliases: ["diff", "patch"], rules: diff },
];

/** The names offered in a code block's language field: the languages highlighted, then maths and diagrams, which are drawn. */
export const LANGUAGE_NAMES = [...LANGUAGES.map((language) => language.aliases[0]!), "math", "mermaid", "text"];

/** The language a fence's info string names, by its first word; undefined for one not highlighted. */
export function languageOf(info: string): Language | undefined {
    const name = info.trim().split(/[\s{]/)[0]!.toLowerCase();
    return name ? LANGUAGES.find((language) => language.aliases.includes(name)) : undefined;
}

/** Cuts code into tokens for the language a fence names. The tokens' texts join back into the code exactly; a language not known is one plain token. */
export function highlight(code: string, info: string): Token[] {
    const language = languageOf(info);
    if (!language || code === "") return code ? [{ kind: "plain", text: code }] : [];
    const out: Token[] = [];
    const push = (kind: TokenKind, text: string) => {
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.text += text;
        else out.push({ kind, text });
    };
    let at = 0;
    outer: while (at < code.length) {
        // spaces are plain, and matched in one go so the patterns are tried only where a token can start
        const space = /[ \t\n]+/y;
        space.lastIndex = at;
        const gap = space.exec(code);
        if (gap) {
            push("plain", gap[0]);
            at += gap[0].length;
            continue;
        }
        for (const [pattern, kind] of language.rules) {
            pattern.lastIndex = at;
            const match = pattern.exec(code);
            if (!match || match[0] === "") continue;
            push(typeof kind === "function" ? kind(match[0], code, at) : kind, match[0]);
            at += match[0].length;
            continue outer;
        }
        push("plain", code[at]!);
        at++;
    }
    return out;
}
