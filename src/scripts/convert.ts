// The page for the file converter (src/pages/convert.astro): the converter on its host, handed the
// pieces of the suite it works through. One kind of the suite never imports another, so imgQuire's
// encoders and metadata writer, and mdQuire's Markdown reader and writer, are brought together here.

import type { MarkdownEngine } from "../quire/convert/markdown";
import { createConvertPage } from "../quire/convert/page";
import { pictureSide } from "../quire/convert/picture-side";
import type { PictureEngine } from "../quire/convert/pictures";
import { audioSide } from "../quire/convert/audio-side";
import { textSide } from "../quire/convert/text-side";
import { decodeHeic, heicIn } from "../quire/img/codec-run";
import { FORMATS, formatOf, underWeight } from "../quire/img/export";
import { blocksOut } from "../quire/img/metadata";
import { readHtml, writeHtml } from "../quire/md/html";
import { read } from "../quire/md/read";
import { write } from "../quire/md/write";

/** imgQuire's export, with each run of an encoder told to the converter so that its bar is true. */
const pictures: PictureEngine = {
    formats: FORMATS.map(({ key, label, short, tip, type, ending, lossy }) => ({ key, label, short, tip, type, ending, lossy })),
    async encode(pixels, settings, meta, tried) {
        const format = formatOf(settings.format);
        const encode = async (quality: number) => {
            const blob = await format.encode(pixels, quality, meta);
            tried();
            return blob;
        };
        if (format.lossy && settings.target) return underWeight(encode, settings.target);
        return { blob: await encode(settings.quality), quality: settings.quality, over: false };
    },
    metadata: (original, keep) => blocksOut(original, keep, {}),
    isHeic: heicIn,
    decodeHeic,
};

/** mdQuire's reader and writer, with a blank line between the blocks HTML gives, as Markdown is usually written. */
const markdown: MarkdownEngine = {
    toHtml: (text) => writeHtml(read(text).blocks),
    fromHtml: (html) => write({ ...read(""), blocks: readHtml(html).map((block, index, all) => ({ ...block, gap: index < all.length - 1 ? "\n\n" : "\n" })) }),
};

const host = document.querySelector<HTMLElement>("#convert");
if (host) createConvertPage(host, [pictureSide(pictures), textSide(markdown), audioSide()]);
