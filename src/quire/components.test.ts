// What the component cards are held to: a tag is read into its name and properties exactly as
// written, on one line or several; changing one property changes only its bytes; and anything that
// is not a single component tag is not read as one.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { fieldsOf, readTag, setProp } from "./components";
import { read } from "./read";
import { write } from "./write";

const FIGURE = '<Figure src="/assets/playmatter.webp" alt="A car beside a tower." width={960} height={488} caption="A figure." pixel />';

test("a component's tag is read into its name, kind and properties, strings, expressions and flags", () => {
    const tag = readTag(FIGURE)!;
    expect(tag.name).toBe("Figure");
    expect(tag.kind).toBe("self");
    expect(tag.props.map((prop) => [prop.name, prop.value, prop.kind])).toEqual([
        ["src", "/assets/playmatter.webp", "string"],
        ["alt", "A car beside a tower.", "string"],
        ["width", "960", "expression"],
        ["height", "488", "expression"],
        ["caption", "A figure.", "string"],
        ["pixel", "", "flag"],
    ]);
    for (const prop of tag.props) expect(FIGURE.slice(prop.from, prop.to).startsWith(prop.name)).toBe(true);
    expect(readTag('<Moment when="2025">')).toMatchObject({ name: "Moment", kind: "open" });
    expect(readTag("</Moment>")).toMatchObject({ name: "Moment", kind: "close" });
    expect(readTag("<Timeline>")).toMatchObject({ name: "Timeline", kind: "open", props: [] });
    expect(readTag('<PlayHere\n    src="https://x.y/game"\n    title="A game"\n    from="x.y"\n>')!.props.map((prop) => prop.name)).toEqual(["src", "title", "from"]);
});

test("what is not one component tag is not read as one", () => {
    for (const text of ["<div>", "<figure>", "import Figure from './x'", '<Figure src="a" /> and more', '<Figure src="a" />\n<Figure src="b" />', "<Figure src=a />", '<Figure src="a', "Text", "{expression}", "<Figure>text</Figure>"]) expect({ text, tag: readTag(text) }).toEqual({ text, tag: undefined });
});

test("changing one property changes only its value, and keeps its kind", () => {
    expect(setProp(FIGURE, "alt", "A new alt.")).toBe(FIGURE.replace("A car beside a tower.", "A new alt."));
    expect(setProp(FIGURE, "width", "1200")).toBe(FIGURE.replace("{960}", "{1200}"));
    expect(setProp(FIGURE, "caption", 'Say "hi"')).toBe(FIGURE.replace('"A figure."', '"Say &quot;hi&quot;"'));
    const spaced = '<Moment\n    when="2025"\n    chapter="One"\n>';
    expect(setProp(spaced, "chapter", "Two")).toBe('<Moment\n    when="2025"\n    chapter="Two"\n>');
});

test("a flag is set and taken away, and a property not there is added before the tag's end", () => {
    expect(setProp(FIGURE, "pixel", false)).toBe(FIGURE.replace(" pixel", ""));
    expect(setProp(FIGURE, "eager", true)).toBe(FIGURE.replace("pixel />", "pixel eager />"));
    expect(setProp(FIGURE, "video", "/a.mp4")).toBe(FIGURE.replace("pixel />", 'pixel video="/a.mp4" />'));
    expect(setProp("<Moment>", "when", "2026")).toBe('<Moment when="2026">');
    expect(setProp('<Figure src="a"/>', "height", "300")).toBe('<Figure src="a" height={300} />');
    // an empty value is not added, and a closing tag has nothing to set
    expect(setProp("<Moment>", "when", "")).toBe("<Moment>");
    expect(setProp("</Moment>", "when", "x")).toBe("</Moment>");
});

test("a card shows the properties given, then those the site's component takes and lacks, in the component's order", () => {
    const fields = fieldsOf(readTag('<Figure alt="x" src="/a.webp" />')!);
    expect(fields.map((field) => [field.name, field.kind])).toEqual([
        ["src", "string"],
        ["alt", "string"],
        ["width", "missing"],
        ["height", "missing"],
        ["caption", "missing"],
        ["video", "missing"],
        ["pixel", "missing"],
        ["eager", "missing"],
    ]);
    expect(fields.find((field) => field.name === "pixel")!.flag).toBe(true);
    expect(fieldsOf(readTag('<Embed src="x" ratio="16 / 6" />')!).map((field) => field.name)).toEqual(["src", "ratio"]);
});

test("every component in the site's MDX files is read as a card, and a changed field writes back only that change", async () => {
    let cards = 0;
    for (const file of await Array.fromAsync(new Glob("src/content/**/*.mdx").scan({ cwd: `${import.meta.dir}/../../` }))) {
        const source = await Bun.file(`${import.meta.dir}/../../${file}`).text();
        const doc = read(source, { mdx: true });
        for (const [index, block] of doc.blocks.entries()) {
            if (block.kind !== "raw" || !/^<\/?[A-Z]/.test(block.text)) continue;
            const tag = readTag(block.text);
            if (!tag) continue;
            cards++;
            const prop = tag.props.find((each) => each.kind === "string");
            if (!prop) continue;
            const changed = setProp(block.text, prop.name, `${prop.value}!`);
            const blocks = doc.blocks.map((each, k) => (k === index ? { ...each, kind: "raw" as const, text: changed, source: undefined } : each));
            expect(write({ ...doc, blocks })).toBe(source.replace(block.text, changed));
        }
    }
    expect(cards).toBeGreaterThan(5);
});
