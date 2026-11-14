// What the maths layout is held to: each construct of the subset comes out as the HTML the styles
// lay out, in a line and as a block; and anything outside the subset gives null, so that the
// surface shows the source rather than a guess.

import { expect, test } from "bun:test";
import { maths } from "./maths";

const inner = (source: string, display = false) => {
    const html = maths(source, display);
    expect(html).not.toBeNull();
    return html!.replace(/^<span class="qm( qm-display)?">/, "").replace(/<\/span>$/, "");
};

test("letters are italic, digits upright, and operators and relations are spaced", () => {
    expect(inner("x+1=y")).toBe('<i>x</i><span class="qm-bin">+</span>1<span class="qm-rel">=</span><i>y</i>');
    expect(inner("a - b < c")).toBe('<i>a</i><span class="qm-bin">−</span><i>b</i><span class="qm-rel">&lt;</span><i>c</i>');
});

test("powers and subscripts take one character or a group, and both together stack", () => {
    expect(inner("x^2")).toBe('<i>x</i><sup class="qm-sup">2</sup>');
    expect(inner("x_{ij}")).toBe('<i>x</i><sub class="qm-sub"><i>i</i><i>j</i></sub>');
    expect(inner("x_i^2")).toBe('<i>x</i><span class="qm-scripts"><span class="qm-sup">2</span><span class="qm-sub"><i>i</i></span></span>');
    expect(inner("e^{i\\pi}")).toContain('<sup class="qm-sup"><i>i</i><i>π</i></sup>');
});

test("fractions, roots and roots with an index", () => {
    expect(inner("\\frac{1}{2}")).toBe('<span class="qm-frac"><span class="qm-num">1</span><span class="qm-den">2</span></span>');
    expect(inner("\\frac12")).toBe('<span class="qm-frac"><span class="qm-num">1</span><span class="qm-den">2</span></span>');
    expect(inner("\\sqrt{x}")).toBe('<span class="qm-sqrt"><span class="qm-radical">√</span><span class="qm-radicand"><i>x</i></span></span>');
    expect(inner("\\sqrt[3]{8}")).toContain('<span class="qm-index">3</span>');
    expect(inner("\\frac{a}{b}", true)).toContain("qm-big-frac");
});

test("Greek letters, operators, arrows and functions", () => {
    expect(inner("\\alpha\\Omega")).toBe("<i>α</i>Ω");
    expect(inner("a \\times b \\leq c \\to \\infty")).toBe('<i>a</i><span class="qm-bin">×</span><i>b</i><span class="qm-rel">≤</span><i>c</i><span class="qm-rel">→</span>∞');
    expect(inner("\\sin x")).toBe('<span class="qm-fn">sin</span><i>x</i>');
    expect(inner("\\text{if } x")).toBe('<span class="qm-text">if </span><i>x</i>');
});

test("sums and integrals take limits under and over in a block, and as scripts in a line", () => {
    expect(inner("\\sum_{i=1}^{n} i", true)).toContain('<span class="qm-limits"><span class="qm-over"><i>n</i></span><span class="qm-base"><span class="qm-big">∑</span></span><span class="qm-under"><i>i</i><span class="qm-rel">=</span>1</span></span>');
    expect(inner("\\sum_{i=1}^{n} i")).toContain('<span class="qm-scripts">');
    // an integral keeps its limits at its side, as is usual
    expect(inner("\\int_0^1 x\\,dx", true)).toContain('<span class="qm-big qm-int">∫</span><span class="qm-scripts">');
    expect(inner("\\lim_{x \\to 0} f", true)).toContain('<span class="qm-limits">');
});

test("brackets sized with left and right, accents and spaces", () => {
    expect(inner("\\left( x \\right)")).toBe('<span class="qm-fence">(</span><i>x</i><span class="qm-fence">)</span>');
    expect(inner("\\hat{x}")).toBe('<span class="qm-accent"><span class="qm-mark">ˆ</span><span><i>x</i></span></span>');
    expect(inner("a\\quad b")).toContain('style="--space: 1"');
});

test("what the subset does not lay out gives null, never a guess", () => {
    for (const source of ["\\begin{matrix} a & b \\end{matrix}", "a \\\\ b", "\\unknowncommand x", "\\frac{1}{", "x^", "}", "x^1^2", "", "   ", "a & b"]) expect({ source, html: maths(source) }).toEqual({ source, html: null });
});

test("text is escaped, so nothing in the source becomes markup", () => {
    expect(inner("\\text{<b>&</b>}")).toBe('<span class="qm-text">&lt;b&gt;&amp;&lt;/b&gt;</span>');
    expect(inner("a<b")).toContain("&lt;");
});
