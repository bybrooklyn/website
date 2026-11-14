// How a picture that has been resized or given a caption is kept, and the counting behind resizing
// and moving one. The tools a person uses on a picture are in picture-tools.ts.
//
// In a Markdown file a picture nobody resized is written as it was, `![alt](address)`. One with a
// width or a caption has no Markdown form, so it is written as the HTML the site's own Markdown
// already passes through, on one line, which reads the same in a `.md` and an `.mdx` file:
//
//   <img src="pictures/cat.png" alt="A cat asleep" width="50%" />
//   <figure><img src="pictures/cat.png" alt="A cat asleep" width="50%" /><figcaption>Our cat</figcaption></figure>
//
// The width is a share of the text's width, so the picture keeps its place in the column on any
// screen. Its alignment is the `<div align>` the writer puts round any block, and a picture the text
// flows round has HTML's own `align="left"` or `align="right"` on its <img>, the float browsers and
// GitHub draw from it, in place of the <div>. With no alignment it sits at the left. The reader takes back
// only exactly these forms; any other HTML stays raw, as its text. In a `.quire` document the
// Markdown stays plain and the width and caption go to style.json with the alignment (styling.ts).

import { blockAt, insertBlock, moveBlock, removeBlock, type Block, type Document, type Image } from "./document";

/** The widths a picture being resized is drawn to when it comes near them, as shares of the text's width, with their names. */
export const SNAPS: [number, string][] = [
    [100, "Full width"],
    [50, "Half"],
    [33, "A third"],
];

/** How near, in percent of the text's width, a width must come to one of the snaps to be drawn to it. */
const PULL = 3;

/** A width being dragged, kept between a tenth and the whole of the text's width, drawn to the snaps when near one. */
export function snapWidth(percent: number): { width: number; snap?: string } {
    const kept = Math.min(100, Math.max(10, percent));
    for (const [width, name] of SNAPS) if (Math.abs(kept - width) <= PULL) return { width, snap: name };
    return { width: Math.round(kept) };
}

/** Text made safe inside an HTML attribute or element; braces too, which MDX would read as code. */
function escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

/** The characters `escape` writes, back. */
function unescape(text: string): string {
    return text.replace(/&(amp|quot|lt|gt|#123|#125);/g, (_, name: string) => ({ amp: "&", quot: '"', lt: "<", gt: ">", "#123": "{", "#125": "}" })[name]!);
}

/** True for a picture that has no Markdown form: one with a width, a caption or text flowing round it. */
export const sized = (block: Image): boolean => block.width !== undefined || !!block.caption || !!block.wrap;

/** A picture with a width, a caption or text flowing round it, as the one line of HTML that keeps it. */
export function pictureHtml(block: Image): string {
    const title = block.title !== undefined ? ` title="${escape(block.title)}"` : "";
    const width = block.width !== undefined ? ` width="${block.width}%"` : "";
    // text flowing round a picture is HTML's own `align` on the <img>, which browsers and GitHub draw as a float
    const wrap = block.wrap ? ` align="${block.align === "right" ? "right" : "left"}"` : "";
    const picture = `<img src="${escape(block.src)}" alt="${escape(block.alt)}"${title}${width}${wrap} />`;
    return block.caption ? `<figure>${picture}<figcaption>${escape(block.caption)}</figcaption></figure>` : picture;
}

const PICTURE = /<img src="([^"]*)" alt="([^"]*)"(?: title="([^"]*)")?(?: width="(\d{1,3})%")?(?: align="(left|right)")? \/>/;
const ALONE = new RegExp(`^${PICTURE.source}$`);
const FIGURE = new RegExp(`^<figure>${PICTURE.source}<figcaption>([^<]*)</figcaption></figure>$`);

/** A picture written in one of the forms `pictureHtml` gives, read back; anything else is not one. */
export function readPicture(text: string): Image | undefined {
    const figure = FIGURE.exec(text);
    const alone = figure ? undefined : ALONE.exec(text);
    const found = figure ?? alone;
    // a lone <img> with no width and no float is ordinary HTML, left as it was written
    if (!found || (alone && found[4] === undefined && found[5] === undefined)) return undefined;
    const block: Image = { kind: "image", src: unescape(found[1]!), alt: unescape(found[2]!), gap: "" };
    if (found[3] !== undefined) block.title = unescape(found[3]);
    if (found[4] !== undefined) {
        const width = Number(found[4]);
        if (width < 1 || width > 100) return undefined;
        block.width = width;
    }
    if (found[5] !== undefined) block.wrap = true;
    if (found[5] === "right") block.align = "right";
    if (figure && figure[6]) block.caption = unescape(figure[6]);
    return block;
}

/** A raw block that is one of the picture forms, as the picture it is, keeping its text as its source; any other block as it was. */
export function asPicture<T extends { kind: string; text?: string }>(block: T): T | Image {
    if (block.kind !== "raw" || block.text === undefined) return block;
    return readPicture(block.text) ?? block;
}

/** A place between two blocks a picture can be dropped: before the block at `path`, or after it. */
export interface Landing {
    path: number[];
    after?: boolean;
}

/**
 * Every place a block can be dropped, in reading order, at every depth: before each block, in the
 * document, in a list's items and in quotes, and after the last block of each of those. A list or
 * quote has a place before it as well as one before its first block, so that a picture can go in or
 * stay out.
 */
export function landings(blocks: Block[], prefix: number[] = []): Landing[] {
    const out: Landing[] = [];
    blocks.forEach((block, index) => {
        const path = [...prefix, index];
        out.push({ path });
        if (block.kind === "list") block.items.forEach((item, at) => out.push(...landings(item.blocks, [...path, at])));
        else if (block.kind === "quote") out.push(...landings(block.blocks, path));
    });
    if (blocks.length) out.push({ path: [...prefix, blocks.length - 1], after: true });
    return out;
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((step, k) => step === b[k]);
const nextOf = (path: number[]) => [...path.slice(0, -1), path[path.length - 1]! + 1];

/** True when dropping the block at `from` on a landing leaves it where it is. */
export const staysPut = (from: number[], to: Landing): boolean => samePath(to.path, from) || (!to.after && samePath(to.path, nextOf(from)));

/** Where the block at `from` stands once moved to a landing (moveBlockTo), when taking it from its old place leaves the blocks round it as they were. */
export function landedAt(from: number[], to: Landing): number[] {
    const at = to.after ? nextOf(to.path) : [...to.path];
    const depth = from.length - 1;
    if (at.length > depth && from.slice(0, depth).every((step, k) => step === at[k]) && from[depth]! < at[depth]!) at[depth]!--;
    return at;
}

/** Moves the block at `from` to a landing, into or out of lists and quotes; one where it already is leaves the document as it was. */
export function moveBlockTo(doc: Document, from: number[], to: Landing): Document {
    const block = blockAt(doc, from);
    if (!block || staysPut(from, to)) return doc;
    // it is put in first and taken from its old place after, so that the landing's path still means what it did
    const index = to.path[to.path.length - 1]!;
    const at = to.after ? nextOf(to.path) : to.path;
    const next = to.after ? insertBlock(doc, to.path, block) : index > 0 ? insertBlock(doc, [...to.path.slice(0, -1), index - 1], block) : moveBlock(insertBlock(doc, to.path, block), nextOf(to.path), -1);
    // its old place moved on by one if it went in before it among the same blocks
    const depth = at.length - 1;
    const old = [...from];
    if (old.length > depth && at.slice(0, depth).every((step, k) => step === old[k]) && old[depth]! >= at[depth]!) old[depth]!++;
    return removeBlock(next, old);
}
