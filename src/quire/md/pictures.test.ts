// What is held true of how a resized or captioned picture is kept: a picture nobody touched is
// written as it was; one with a width or caption is written as the one line of HTML the site's
// Markdown passes through, and read back from exactly that; in a `.quire` document the Markdown
// stays plain and both go to style.json. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { setAlign, setImage, type Image } from "./document";
import { read } from "./read";
import { landedAt, landings, moveBlockTo, pictureHtml, readPicture, snapWidth, staysPut } from "./pictures";
import { collect, readStyle, restore } from "./styling";
import { write } from "./write";

const POST = "# A post\n\n![A cat asleep](pictures/cat.png)\n\nThe end.\n";

test("a picture nobody resized is written exactly as it was, title and odd spacing and all", () => {
    const text = "Words.\n\n![A cat](<pictures/a cat.png> 'hers')\n\nMore.\n";
    expect(write(read(text))).toBe(text);
    expect(write(read(POST))).toBe(POST);
});

test("a picture given a width is written as an <img> with the width as a share of the text, and read back as the same picture", () => {
    const doc = setImage(read(POST), [1], { width: 50 });
    const out = write(doc);
    expect(out).toBe('# A post\n\n<img src="pictures/cat.png" alt="A cat asleep" width="50%" />\n\nThe end.\n');
    const again = read(out);
    expect(again.blocks[1]).toMatchObject({ kind: "image", src: "pictures/cat.png", alt: "A cat asleep", width: 50 });
    // and the file read back goes out byte for byte
    expect(write(again)).toBe(out);
});

test("a caption makes a <figure> with a <figcaption>, and centring wraps it in the writer's <div align>", () => {
    let doc = setImage(read(POST), [1], { width: 33, caption: 'Our cat, "Moss" {asleep} & <dreaming>' });
    doc = setAlign(doc, [1], "center");
    const out = write(doc);
    expect(out).toContain('<div align="center">\n\n<figure><img src="pictures/cat.png" alt="A cat asleep" width="33%" /><figcaption>Our cat, &quot;Moss&quot; &#123;asleep&#125; &amp; &lt;dreaming&gt;</figcaption></figure>\n\n</div>');
    const back = read(out).blocks[1] as Image;
    expect(back).toMatchObject({ kind: "image", width: 33, align: "center", caption: 'Our cat, "Moss" {asleep} & <dreaming>' });
    expect(write(read(out, { mdx: true }))).toBe(out);
});

test("a caption with no width is kept too, and taking both away gives back plain Markdown", () => {
    const captioned = setImage(read(POST), [1], { caption: "Moss" });
    expect(write(captioned)).toContain('<figure><img src="pictures/cat.png" alt="A cat asleep" /><figcaption>Moss</figcaption></figure>');
    const plain = setImage(read(write(captioned)), [1], { width: undefined, caption: undefined });
    expect(write(plain)).toBe(POST);
});

test("only the exact forms are read as pictures: other HTML stays raw, as its text", () => {
    expect(readPicture('<img src="a.png" alt="b" />')).toBeUndefined();
    expect(readPicture('<img src="a.png" alt="b" width="480" />')).toBeUndefined();
    expect(readPicture('<img class="x" src="a.png" alt="b" width="50%" />')).toBeUndefined();
    expect(readPicture('<img src="a.png" alt="b" width="0%" />')).toBeUndefined();
    for (const text of ['<img src="a.png" alt="b" width="480">\n', '<figure class="figure"><img src="a.png" alt="b" /></figure>\n']) {
        expect(read(text).blocks[0]!.kind).toBe("raw");
        expect(write(read(text))).toBe(text);
    }
});

test("pictureHtml and readPicture agree on every field, the title included", () => {
    const block: Image = { kind: "image", src: "pictures/x y.png", alt: 'a "b"', title: "t", width: 75, caption: "c", gap: "" };
    expect(readPicture(pictureHtml(block))).toEqual({ ...block, gap: "" });
    expect(readPicture(pictureHtml({ ...block, wrap: true, align: "right" }))).toEqual({ ...block, wrap: true, align: "right" });
});

test("text flowing round a picture is HTML's own align on the <img>, with no <div>, and reads back exactly; centring takes it away", () => {
    const left = setImage(read(POST), [1], { wrap: true });
    expect(write(left)).toBe('# A post\n\n<img src="pictures/cat.png" alt="A cat asleep" align="left" />\n\nThe end.\n');
    expect(read(write(left)).blocks[1]).toMatchObject({ kind: "image", wrap: true });
    expect((read(write(left)).blocks[1] as Image).align).toBeUndefined();
    const right = setImage(setAlign(read(POST), [1], "right"), [1], { wrap: true, width: 40, caption: "Moss" });
    const out = write(right);
    expect(out).toContain('<figure><img src="pictures/cat.png" alt="A cat asleep" width="40%" align="right" /><figcaption>Moss</figcaption></figure>');
    expect(out).not.toContain("<div");
    expect(write(read(out))).toBe(out);
    expect(read(out).blocks[1]).toMatchObject({ align: "right", wrap: true, width: 40 });
    // a centred picture has no side for the text to flow round, so wrap moves it to the left
    expect(setImage(setAlign(read(POST), [1], "center"), [1], { wrap: true }).blocks[1]).toMatchObject({ wrap: true });
    expect((setImage(setAlign(read(POST), [1], "center"), [1], { wrap: true }).blocks[1] as Image).align).toBeUndefined();
    expect((setAlign(left, [1], "center").blocks[1] as Image).wrap).toBeUndefined();
    // taken off again, the picture is plain Markdown once more
    expect(write(setImage(read(write(left)), [1], { wrap: false }))).toBe(POST);
    // an <img> with HTML's align but no width is a picture too; other values stay raw
    expect(readPicture('<img src="a.png" alt="b" align="right" />')).toMatchObject({ wrap: true, align: "right" });
    expect(read('<img src="a.png" alt="b" align="middle" />\n').blocks[0]!.kind).toBe("raw");
});

test("a width being dragged is drawn to the whole, half and a third of the text when near them, and kept within a tenth and the whole", () => {
    expect(snapWidth(98)).toEqual({ width: 100, snap: "Full width" });
    expect(snapWidth(140)).toEqual({ width: 100, snap: "Full width" });
    expect(snapWidth(52.4)).toEqual({ width: 50, snap: "Half" });
    expect(snapWidth(31)).toEqual({ width: 33, snap: "A third" });
    expect(snapWidth(42.4)).toEqual({ width: 42 });
    expect(snapWidth(2)).toEqual({ width: 10 });
});

test("a picture moved to another place stands there, the other blocks written as they were", () => {
    const text = "One.\n\n![Moss](m.png)\n\nTwo.\n\nThree.\n";
    expect(write(moveBlockTo(read(text), [1], { path: [3], after: true }))).toBe("One.\n\nTwo.\n\nThree.\n\n![Moss](m.png)\n");
    expect(write(moveBlockTo(read(text), [1], { path: [0] }))).toBe("![Moss](m.png)\n\nOne.\n\nTwo.\n\nThree.\n");
    expect(write(moveBlockTo(read(text), [1], { path: [3] }))).toBe("One.\n\nTwo.\n\n![Moss](m.png)\n\nThree.\n");
    // to where it already is, nothing changes
    for (const to of [{ path: [1] }, { path: [2] }, { path: [1], after: true }]) expect(moveBlockTo(read(text), [1], to)).toEqual(read(text));
});

test("a picture can be dropped before any block at any depth, into and out of lists and quotes", () => {
    const text = "![Moss](m.png)\n\n- one\n- two\n\n> quoted\n\nEnd.\n";
    const doc = read(text);
    expect(landings(doc.blocks)).toEqual([
        { path: [0] },
        { path: [1] },
        { path: [1, 0, 0] },
        { path: [1, 0, 0], after: true },
        { path: [1, 1, 0] },
        { path: [1, 1, 0], after: true },
        { path: [2] },
        { path: [2, 0] },
        { path: [2, 0], after: true },
        { path: [3] },
        { path: [3], after: true },
    ]);
    expect(write(moveBlockTo(doc, [0], { path: [1, 1, 0], after: true }))).toBe("- one\n- two\n\n  ![Moss](m.png)\n\n> quoted\n\nEnd.\n");
    expect(write(moveBlockTo(doc, [0], { path: [2, 0] }))).toBe("- one\n- two\n\n> ![Moss](m.png)\n>\n> quoted\n\nEnd.\n");
    // and back out of a quote, to the end
    const quoted = moveBlockTo(doc, [0], { path: [2, 0], after: true });
    expect(write(moveBlockTo(quoted, [1, 1], { path: [2], after: true }))).toBe("- one\n- two\n\n> quoted\n\nEnd.\n\n![Moss](m.png)\n");
    // out of a list item that holds nothing else
    const alone = read("- ![Moss](m.png)\n- two\n\nEnd.\n");
    expect(write(moveBlockTo(alone, [0, 0, 0], { path: [1], after: true }))).toBe("- two\n\nEnd.\n\n![Moss](m.png)\n");
    expect(staysPut([1, 0, 0], { path: [1, 0, 0], after: true })).toBe(true);
    // and where it then stands, for it to be picked there
    expect(landedAt([0], { path: [2, 0] })).toEqual([1, 0]);
    expect(landedAt([0], { path: [3], after: true })).toEqual([3]);
    expect(landedAt([3], { path: [0] })).toEqual([0]);
    expect(landedAt([1, 1], { path: [1, 0] })).toEqual([1, 0]);
});

test("in a .quire document the Markdown stays plain and the width and caption go to style.json, and come back", () => {
    const doc = setImage({ ...read(POST), quire: { page: { size: "A4", orientation: "portrait", margins: 25 }, notes: null } }, [1], { width: 50, caption: "Moss", wrap: true });
    const { markdown, style } = collect(doc);
    expect(markdown).toBe(POST);
    expect(style.blocks).toEqual([{ block: 1, hash: expect.any(String), width: 50, caption: "Moss", wrap: true }]);
    const back = restore(read(markdown), readStyle(JSON.stringify(style)));
    expect(back.blocks[1]).toMatchObject({ kind: "image", width: 50, caption: "Moss", wrap: true });
    // restored, the picture is still as it was read, so it is written back byte for byte
    expect(write(back)).toBe(POST);
});
