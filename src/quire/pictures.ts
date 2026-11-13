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
// screen. Its alignment is the `<div align>` the writer puts round any block. The reader takes back
// only exactly these forms; any other HTML stays raw, as its text. In a `.quire` document the
// Markdown stays plain and the width and caption go to style.json with the alignment (styling.ts).

import { insertBlock, moveBlock, removeBlock, type Document, type Image } from "./document";

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

/**
 * A picture's real kind, read from its first bytes rather than its name: PNG, JPEG, GIF, WebP, AVIF
 * or BMP. A file named `.svg` that is an SVG is one too, shown only ever as a picture. Anything else
 * (an HTML page or a script with a picture's name) is plain bytes, which a browser never draws as a
 * page.
 */
export function pictureType(bytes: Uint8Array, name = ""): string {
    const at = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    if (bytes[0] === 0x89 && at(1, "PNG\r\n")) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
    if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
    if (at(4, "ftypavif") || at(4, "ftypavis")) return "image/avif";
    if (at(0, "BM") && bytes.length > 26) return "image/bmp";
    if (/\.svg$/i.test(name) && /^(\ufeff)?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 2048)))) return "image/svg+xml";
    return "application/octet-stream";
}

/** Text made safe inside an HTML attribute or element; braces too, which MDX would read as code. */
function escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

/** The characters `escape` writes, back. */
function unescape(text: string): string {
    return text.replace(/&(amp|quot|lt|gt|#123|#125);/g, (_, name: string) => ({ amp: "&", quot: '"', lt: "<", gt: ">", "#123": "{", "#125": "}" })[name]!);
}

/** True for a picture that has no Markdown form: one with a width or a caption. */
export const sized = (block: Image): boolean => block.width !== undefined || !!block.caption;

/** A picture with a width or a caption, as the one line of HTML that keeps it. */
export function pictureHtml(block: Image): string {
    const title = block.title !== undefined ? ` title="${escape(block.title)}"` : "";
    const width = block.width !== undefined ? ` width="${block.width}%"` : "";
    const picture = `<img src="${escape(block.src)}" alt="${escape(block.alt)}"${title}${width} />`;
    return block.caption ? `<figure>${picture}<figcaption>${escape(block.caption)}</figcaption></figure>` : picture;
}

const PICTURE = /<img src="([^"]*)" alt="([^"]*)"(?: title="([^"]*)")?(?: width="(\d{1,3})%")? \/>/;
const ALONE = new RegExp(`^${PICTURE.source}$`);
const FIGURE = new RegExp(`^<figure>${PICTURE.source}<figcaption>([^<]*)</figcaption></figure>$`);

/** A picture written in one of the forms `pictureHtml` gives, read back; anything else is not one. */
export function readPicture(text: string): Image | undefined {
    const figure = FIGURE.exec(text);
    const alone = figure ? undefined : ALONE.exec(text);
    const found = figure ?? alone;
    // a lone <img> with no width is ordinary HTML, left as it was written
    if (!found || (alone && found[4] === undefined)) return undefined;
    const block: Image = { kind: "image", src: unescape(found[1]!), alt: unescape(found[2]!), gap: "" };
    if (found[3] !== undefined) block.title = unescape(found[3]);
    if (found[4] !== undefined) {
        const width = Number(found[4]);
        if (width < 1 || width > 100) return undefined;
        block.width = width;
    }
    if (figure && figure[5]) block.caption = unescape(figure[5]);
    return block;
}

/** A raw block that is one of the picture forms, as the picture it is, keeping its text as its source; any other block as it was. */
export function asPicture<T extends { kind: string; text?: string }>(block: T): T | Image {
    if (block.kind !== "raw" || block.text === undefined) return block;
    return readPicture(block.text) ?? block;
}

/** Moves the top-level block at `from` so that it stands before the block now at `to` (the end when `to` is the number of blocks). */
export function moveTo(doc: Document, from: number, to: number): Document {
    const block = doc.blocks[from];
    if (!block || to === from || to === from + 1 || to < 0 || to > doc.blocks.length) return doc;
    let next = removeBlock(doc, [from]);
    const place = to > from ? to - 1 : to;
    if (place === 0) {
        next = insertBlock(next, [0], block);
        return moveBlock(next, [1], -1);
    }
    return insertBlock(next, [place - 1], block);
}
