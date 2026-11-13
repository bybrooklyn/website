// What highlighting is held to: the tokens join back into the code exactly, in every language and on
// code that is broken halfway through being typed; each language finds its keywords, strings,
// comments and numbers; and a long block is cut quickly enough to be done off the keystroke's path.

import { expect, test } from "bun:test";
import { highlight, LANGUAGES, languageOf, type TokenKind } from "./highlight";

const kinds = (code: string, info: string) => highlight(code, info).filter((token) => token.kind !== "plain" && token.text.trim()).map((token) => [token.kind, token.text] as [TokenKind, string]);
const has = (code: string, info: string, kind: TokenKind, text: string) => expect(kinds(code, info)).toContainEqual([kind, text]);

const SAMPLES: Record<string, string> = {
    typescript: 'import { read } from "./read";\n// a comment\nexport function twice(n: number): number {\n    const s = `x ${n}`;\n    return n * 2; /* done */\n}\n',
    javascript: "const xs = [1, 2.5, 0xff];\nxs.map((x) => x * 2); // twice\nconst re = 'single' + \"double\";\n",
    rust: 'fn main() {\n    let x: u32 = 42;\n    println!("{}", x); // out\n}\n',
    go: 'package main\n\nfunc main() {\n\tfmt.Println("hi", nil, 3.5)\n}\n',
    python: 'def twice(n):\n    """Doubles."""\n    return n * 2  # simple\n@cache\nclass A: pass\n',
    shell: 'sudo pacman -S --needed git # tools\nexport NAME="x"\necho $HOME ${PATH} | grep bin\n',
    json: '{ "name": "site", "count": 3, "ok": true, "none": null }\n',
    css: ".quire pre { color: var(--accent); margin: 0.5rem 0; } /* code */\n@media (max-width: 40rem) { a:hover { opacity: 0.5; } }\n",
    html: '<!-- note -->\n<a href="/x" class="y">Hi &amp; bye</a>\n<Figure src="/a.webp" width={960} />\n',
    markdown: "# Title\n\nSome **bold** and *italic* and `code` and [a link](https://x.y).\n\n- item\n> quote\n",
    yaml: "# setting\ntitle: Hello\ndraft: false\ncount: 3\ntags: [a, b]\n",
    toml: '[package]\nname = "site"\nversion = "0.1.0"\nok = true\n',
    diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
};

test("the tokens always join back into the code exactly, whole or cut off at any point", () => {
    for (const language of LANGUAGES) {
        const sample = SAMPLES[language.name]!;
        expect(sample).toBeDefined();
        for (let cut = 0; cut <= sample.length; cut++) {
            const code = sample.slice(0, cut);
            expect(highlight(code, language.aliases[0]!).map((token) => token.text).join("")).toBe(code);
        }
    }
    expect(highlight("anything at all", "nonsense")).toEqual([{ kind: "plain", text: "anything at all" }]);
    expect(highlight("", "ts")).toEqual([]);
});

test("a fence's info names its language by any of its usual names, case and extra words aside", () => {
    expect(languageOf("ts")?.name).toBe("typescript");
    expect(languageOf("TSX title=x")?.name).toBe("typescript");
    expect(languageOf("bash")?.name).toBe("shell");
    expect(languageOf("sh")?.name).toBe("shell");
    expect(languageOf("yml")?.name).toBe("yaml");
    expect(languageOf("rs{1,3}")?.name).toBe("rust");
    expect(languageOf("")).toBeUndefined();
    expect(languageOf("brainfuck")).toBeUndefined();
});

test("TypeScript and JavaScript find keywords, strings, template strings, comments, numbers, functions and types", () => {
    const code = SAMPLES.typescript!;
    has(code, "ts", "keyword", "import");
    has(code, "ts", "string", '"./read"');
    has(code, "ts", "comment", "// a comment");
    has(code, "ts", "comment", "/* done */");
    has(code, "ts", "function", "twice");
    has(code, "ts", "type", "number");
    has(code, "ts", "string", "`x ${n}`");
    has(code, "ts", "number", "2");
    // a keyword inside a string or comment is not a keyword
    expect(kinds('"return"', "js")).toEqual([["string", '"return"']]);
});

test("Rust, Go and Python find what is theirs", () => {
    has(SAMPLES.rust!, "rust", "keyword", "fn");
    has(SAMPLES.rust!, "rust", "function", "println!");
    has(SAMPLES.rust!, "rust", "type", "u32");
    has(SAMPLES.rust!, "rust", "number", "42");
    has(SAMPLES.go!, "go", "keyword", "func");
    has(SAMPLES.go!, "go", "constant", "nil");
    has(SAMPLES.go!, "go", "number", "3.5");
    has(SAMPLES.python!, "py", "keyword", "def");
    has(SAMPLES.python!, "py", "string", '"""Doubles."""');
    has(SAMPLES.python!, "py", "comment", "# simple");
    has(SAMPLES.python!, "py", "attribute", "@cache");
});

test("the shell finds commands, options, variables, strings and comments, and a # inside a word is not a comment", () => {
    const code = SAMPLES.shell!;
    has(code, "sh", "keyword", "sudo");
    has(code, "sh", "function", "pacman");
    has(code, "sh", "attribute", "--needed");
    has(code, "sh", "comment", "# tools");
    has(code, "sh", "variable", "$HOME");
    has(code, "sh", "variable", "${PATH}");
    has(code, "sh", "function", "grep");
    expect(kinds("echo a#b", "sh").some(([kind]) => kind === "comment")).toBe(false);
});

test("JSON, CSS, HTML, Markdown, YAML, TOML and diffs find what is theirs", () => {
    has(SAMPLES.json!, "json", "property", '"name"');
    has(SAMPLES.json!, "json", "string", '"site"');
    has(SAMPLES.json!, "json", "constant", "true");
    has(SAMPLES.css!, "css", "property", "color");
    has(SAMPLES.css!, "css", "variable", "--accent");
    has(SAMPLES.css!, "css", "number", "0.5rem");
    has(SAMPLES.css!, "css", "keyword", "@media");
    has(SAMPLES.css!, "css", "tag", ".quire");
    has(SAMPLES.html!, "html", "comment", "<!-- note -->");
    has(SAMPLES.html!, "html", "tag", "<a");
    has(SAMPLES.html!, "html", "attribute", "href");
    has(SAMPLES.html!, "html", "variable", "{960}");
    has(SAMPLES.markdown!, "md", "heading", "# Title");
    has(SAMPLES.markdown!, "md", "keyword", "**bold**");
    has(SAMPLES.markdown!, "md", "string", "`code`");
    has(SAMPLES.yaml!, "yaml", "property", "title");
    has(SAMPLES.yaml!, "yaml", "constant", "false");
    has(SAMPLES.toml!, "toml", "tag", "[package]");
    has(SAMPLES.toml!, "toml", "property", "name");
    has(SAMPLES.diff!, "diff", "inserted", "+new");
    has(SAMPLES.diff!, "diff", "deleted", "-old");
});

test("a block of two thousand lines is cut in well under a frame's time", () => {
    const code = SAMPLES.typescript!.repeat(330);
    expect(code.split("\n").length).toBeGreaterThan(1900);
    highlight(code, "ts");
    const start = performance.now();
    const tokens = highlight(code, "ts");
    const took = performance.now() - start;
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    console.log(`highlighting ${code.length} characters of TypeScript took ${took.toFixed(1)} ms`);
    expect(took).toBeLessThan(40);
});
