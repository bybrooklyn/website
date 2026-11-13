// Maths, laid out by mdQuire's own code in HTML and CSS: a modest part of TeX, written as a block,
// between `$$` lines or in a `math` fence (a `$` in a line is a dollar sign). What it lays out:
//
//   letters (in italic), digits, + - = < > and the like, brackets
//   x^2, x_i, x_i^2, with a single character or a {group}
//   \frac{a}{b} (and \dfrac, \tfrac), \sqrt{x}, \sqrt[n]{x}
//   Greek letters, \alpha to \omega and \Gamma to \Omega
//   \sum, \prod, \int, \oint, \bigcup, \bigcap with limits (under and over in a block)
//   \lim, \max, \min, \sin, \cos, \log, \ln, \exp and the other usual functions, upright
//   the common operators, relations and arrows: \times \cdot \pm \leq \geq \neq \approx \equiv
//   \to \rightarrow \Rightarrow \infty \partial \nabla \in \subset \cup \cap \forall \exists and more
//   \left( and \right), \text{...}, \mathrm{...}, \mathbf{...}, \operatorname{...}
//   \hat \bar \vec \dot \tilde \overline, and the spaces \, \; \: \! \quad \qquad
//
// Anything else (an environment, a command not listed, a brace left open) is not guessed at: `maths`
// gives back null and the surface shows the source instead. The source is always what is saved.

/** Greek letters by name. */
const GREEK: Record<string, string> = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

/** Symbols by name, and whether each is spaced as a relation, a binary operator, or not at all. */
const SYMBOLS: Record<string, [string, "rel" | "bin" | "ord"]> = {
    times: ["×", "bin"], cdot: ["·", "bin"], div: ["÷", "bin"], pm: ["±", "bin"], mp: ["∓", "bin"], ast: ["∗", "bin"], star: ["⋆", "bin"], circ: ["∘", "bin"], bullet: ["•", "bin"], oplus: ["⊕", "bin"], otimes: ["⊗", "bin"], cup: ["∪", "bin"], cap: ["∩", "bin"], setminus: ["∖", "bin"], wedge: ["∧", "bin"], vee: ["∨", "bin"], land: ["∧", "bin"], lor: ["∨", "bin"],
    leq: ["≤", "rel"], le: ["≤", "rel"], geq: ["≥", "rel"], ge: ["≥", "rel"], neq: ["≠", "rel"], ne: ["≠", "rel"], approx: ["≈", "rel"], equiv: ["≡", "rel"], sim: ["∼", "rel"], simeq: ["≃", "rel"], cong: ["≅", "rel"], propto: ["∝", "rel"], ll: ["≪", "rel"], gg: ["≫", "rel"],
    in: ["∈", "rel"], notin: ["∉", "rel"], ni: ["∋", "rel"], subset: ["⊂", "rel"], supset: ["⊃", "rel"], subseteq: ["⊆", "rel"], supseteq: ["⊇", "rel"], mid: ["∣", "rel"], parallel: ["∥", "rel"], perp: ["⊥", "rel"],
    to: ["→", "rel"], rightarrow: ["→", "rel"], leftarrow: ["←", "rel"], gets: ["←", "rel"], leftrightarrow: ["↔", "rel"], Rightarrow: ["⇒", "rel"], Leftarrow: ["⇐", "rel"], Leftrightarrow: ["⇔", "rel"], implies: ["⟹", "rel"], iff: ["⟺", "rel"], mapsto: ["↦", "rel"], longrightarrow: ["⟶", "rel"], uparrow: ["↑", "rel"], downarrow: ["↓", "rel"],
    infty: ["∞", "ord"], partial: ["∂", "ord"], nabla: ["∇", "ord"], forall: ["∀", "ord"], exists: ["∃", "ord"], nexists: ["∄", "ord"], emptyset: ["∅", "ord"], varnothing: ["∅", "ord"], neg: ["¬", "ord"], lnot: ["¬", "ord"], angle: ["∠", "ord"], triangle: ["△", "ord"], degree: ["°", "ord"], prime: ["′", "ord"], hbar: ["ℏ", "ord"], ell: ["ℓ", "ord"], Re: ["ℜ", "ord"], Im: ["ℑ", "ord"], aleph: ["ℵ", "ord"],
    ldots: ["…", "ord"], cdots: ["⋯", "ord"], vdots: ["⋮", "ord"], ddots: ["⋱", "ord"], dots: ["…", "ord"],
    langle: ["⟨", "ord"], rangle: ["⟩", "ord"], lfloor: ["⌊", "ord"], rfloor: ["⌋", "ord"], lceil: ["⌈", "ord"], rceil: ["⌉", "ord"], vert: ["|", "ord"], Vert: ["‖", "ord"], lbrace: ["{", "ord"], rbrace: ["}", "ord"],
    "{": ["{", "ord"], "}": ["}", "ord"], "%": ["%", "ord"], $: ["$", "ord"], "&": ["&amp;", "ord"], "#": ["#", "ord"], _: ["_", "ord"], "|": ["‖", "ord"],
};

/** Big operators, which take limits under and over them in a block. */
const BIG: Record<string, string> = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂", bigoplus: "⨁", bigotimes: "⨂" };

/** Functions written upright; the second set takes its limits under it in a block. */
const FUNCTIONS = new Set("sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp det dim ker deg arg gcd hom Pr".split(" "));
const LIMITED = new Set("lim limsup liminf max min sup inf".split(" "));

/** Accents, each set as a small mark over what it accents. */
const ACCENTS: Record<string, string> = { hat: "ˆ", widehat: "ˆ", tilde: "˜", widetilde: "˜", dot: "˙", ddot: "¨", vec: "→", acute: "ˊ", grave: "ˋ", check: "ˇ", breve: "˘" };

/** Spaces by command, in em. */
const SPACES: Record<string, number> = { ",": 0.17, ":": 0.22, ">": 0.22, ";": 0.28, " ": 0.33, quad: 1, qquad: 2, "!": -0.17 };

class Unsupported extends Error {}

const escape = (text: string) => text.replace(/&(?!amp;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Reads TeX one piece at a time. */
class Reader {
    at = 0;
    constructor(readonly source: string) {}

    skip() {
        while (/\s/.test(this.source[this.at] ?? "")) this.at++;
    }

    peek(): string | undefined {
        this.skip();
        return this.source[this.at];
    }

    /** A command's name after its backslash: a run of letters, or one other character. */
    command(): string {
        this.at++;
        const letters = /^[A-Za-z]+/.exec(this.source.slice(this.at));
        const name = letters ? letters[0] : this.source[this.at] ?? "";
        if (!name) throw new Unsupported("a backslash at the end");
        this.at += name.length;
        return name;
    }

    /** What is inside the next `{...}`, as raw text, for \text and the like. */
    rawGroup(): string {
        if (this.peek() !== "{") throw new Unsupported("a group was expected");
        let depth = 0;
        const start = this.at + 1;
        for (; this.at < this.source.length; this.at++) {
            const char = this.source[this.at];
            if (char === "\\") this.at++;
            else if (char === "{") depth++;
            else if (char === "}" && --depth === 0) return this.source.slice(start, this.at++);
        }
        throw new Unsupported("a brace left open");
    }
}

/** Lays out a list of pieces until a `}` or the end. */
function list(reader: Reader, display: boolean, until?: string): string {
    let out = "";
    for (;;) {
        const next = reader.peek();
        if (next === undefined) {
            if (until) throw new Unsupported("a group left open");
            return out;
        }
        if (next === until) {
            reader.at++;
            return out;
        }
        if (next === "}") throw new Unsupported("a brace closed that was not opened");
        if (next === "&" || (next === "\\" && reader.source[reader.at + 1] === "\\")) throw new Unsupported("alignment and line breaks are not laid out");
        out += scripted(reader, display);
    }
}

/** One piece with any `^` and `_` after it. */
function scripted(reader: Reader, display: boolean): string {
    const start = reader.at;
    const { html, limits } = atom(reader, display);
    let sup: string | undefined;
    let sub: string | undefined;
    for (let next = reader.peek(); next === "^" || next === "_"; next = reader.peek()) {
        reader.at++;
        const part = argument(reader, display);
        if (next === "^") {
            if (sup !== undefined) throw new Unsupported("two superscripts");
            sup = part;
        } else {
            if (sub !== undefined) throw new Unsupported("two subscripts");
            sub = part;
        }
    }
    if (reader.at === start) throw new Unsupported("nothing to read");
    if (sup === undefined && sub === undefined) return html;
    if (limits && display) return `<span class="qm-limits">${sup !== undefined ? `<span class="qm-over">${sup}</span>` : ""}<span class="qm-base">${html}</span>${sub !== undefined ? `<span class="qm-under">${sub}</span>` : ""}</span>`;
    if (sup !== undefined && sub !== undefined) return `${html}<span class="qm-scripts"><span class="qm-sup">${sup}</span><span class="qm-sub">${sub}</span></span>`;
    return sup !== undefined ? `${html}<sup class="qm-sup">${sup}</sup>` : `${html}<sub class="qm-sub">${sub}</sub>`;
}

/** The argument of a command or script: a group, a command, or one character. */
function argument(reader: Reader, display: boolean): string {
    const next = reader.peek();
    if (next === undefined) throw new Unsupported("an argument was expected");
    if (next === "{") {
        reader.at++;
        return list(reader, display, "}");
    }
    if (next === "\\") return atom(reader, display).html;
    reader.at++;
    return character(next);
}

/** A character as it is set: letters in italic, operators spaced, the rest as they are. */
function character(char: string): string {
    if (/[A-Za-z]/.test(char)) return `<i>${char}</i>`;
    if (/[0-9.]/.test(char)) return char;
    if (char === "-") return '<span class="qm-bin">−</span>';
    if (char === "*") return '<span class="qm-bin">∗</span>';
    if (char === "+") return '<span class="qm-bin">+</span>';
    if ("=<>:".includes(char)) return `<span class="qm-rel">${escape(char)}</span>`;
    if (char === "'") return "′";
    if (char === "~") return '<span class="qm-space" style="--space: 0.33"></span>';
    if (",;".includes(char)) return `<span class="qm-punct">${char}</span>`;
    if ("()[]|/!?".includes(char)) return char;
    if (/[\p{L}\p{N}\p{S}]/u.test(char)) return escape(char);
    throw new Unsupported(`the character ${char}`);
}

function atom(reader: Reader, display: boolean): { html: string; limits?: boolean } {
    const next = reader.peek()!;
    if (next === "{") {
        reader.at++;
        return { html: list(reader, display, "}") };
    }
    if (next !== "\\") {
        reader.at++;
        return { html: character(next) };
    }
    const name = reader.command();
    if (GREEK[name]) return { html: /^[A-Z]/.test(name) ? GREEK[name]! : `<i>${GREEK[name]}</i>` };
    if (SYMBOLS[name]) {
        const [symbol, kind] = SYMBOLS[name]!;
        return { html: kind === "ord" ? symbol : `<span class="qm-${kind}">${symbol}</span>` };
    }
    if (SPACES[name] !== undefined) return { html: `<span class="qm-space" style="--space: ${SPACES[name]}"></span>` };
    if (BIG[name]) return { html: `<span class="qm-big${name.includes("int") ? " qm-int" : ""}">${BIG[name]}</span>`, limits: !name.includes("int") };
    if (FUNCTIONS.has(name)) return { html: `<span class="qm-fn">${name}</span>` };
    if (LIMITED.has(name)) return { html: `<span class="qm-fn">${name}</span>`, limits: true };
    switch (name) {
        case "frac":
        case "dfrac":
        case "tfrac": {
            const top = argument(reader, display);
            const bottom = argument(reader, display);
            return { html: `<span class="qm-frac${name === "dfrac" || (display && name !== "tfrac") ? " qm-big-frac" : ""}"><span class="qm-num">${top}</span><span class="qm-den">${bottom}</span></span>` };
        }
        case "sqrt": {
            let index = "";
            if (reader.peek() === "[") {
                reader.at++;
                index = list(reader, display, "]");
            }
            const body = argument(reader, display);
            return { html: `<span class="qm-sqrt">${index ? `<span class="qm-index">${index}</span>` : ""}<span class="qm-radical">√</span><span class="qm-radicand">${body}</span></span>` };
        }
        case "text":
        case "textrm":
        case "mathrm":
        case "operatorname":
            return { html: `<span class="qm-text">${escape(reader.rawGroup())}</span>` };
        case "mathbf":
        case "textbf":
        case "boldsymbol":
            return { html: `<b>${argument(reader, display)}</b>` };
        case "mathit":
        case "textit":
            return { html: `<i>${argument(reader, display)}</i>` };
        case "overline":
        case "bar":
            return { html: `<span class="qm-overline">${argument(reader, display)}</span>` };
        case "underline":
            return { html: `<span class="qm-underline">${argument(reader, display)}</span>` };
        case "left":
        case "right":
        case "big":
        case "Big":
        case "bigg":
        case "Bigg": {
            // a sized bracket is set at the size of the text: the bracket itself is kept
            const next = reader.peek();
            if (next === undefined) throw new Unsupported("a bracket was expected");
            if (next === ".") {
                reader.at++;
                return { html: "" };
            }
            if (next === "\\") return { html: `<span class="qm-fence">${atom(reader, display).html}</span>` };
            reader.at++;
            if (!"()[]|/<>".includes(next)) throw new Unsupported("not a bracket");
            return { html: `<span class="qm-fence">${next === "<" ? "⟨" : next === ">" ? "⟩" : next}</span>` };
        }
    }
    if (ACCENTS[name]) {
        const body = argument(reader, display);
        return { html: `<span class="qm-accent"><span class="qm-mark">${ACCENTS[name]}</span><span>${body}</span></span>` };
    }
    throw new Unsupported(`\\${name}`);
}

/** Lays out TeX as HTML, in a line or as a block; null if it uses anything the subset does not lay out. */
export function maths(source: string, display = false): string | null {
    if (source.trim() === "") return null;
    try {
        const body = list(new Reader(source), display);
        return `<span class="qm${display ? " qm-display" : ""}">${body}</span>`;
    } catch (error) {
        if (error instanceof Unsupported) return null;
        throw error;
    }
}
