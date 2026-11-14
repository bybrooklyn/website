// Reading the text in a picture, from its pixels to its lines and words, with the models given as
// four plain calls so that the same steps run on ONNX Runtime in the worker and on stand-ins in the
// tests. The steps, in order:
//
// 1. With the largest size, a page turned on its side is found and turned upright first.
// 2. The detector reads the picture in tiles (detect.ts), at its own size up to 4000 a side, and the
//    lines are found in the map it gives.
// 3. Each line is cut out of the picture at full size along its slant, 48 high (pixels.ts).
// 4. With the two larger sizes, a line upside down is turned the right way up.
// 5. The recognizer reads the lines eight at a time, the narrowest together, each batch as wide as
//    its widest line and at least 320, as PaddleOCR does; the answer is read as CTC (ctc.ts) and its
//    words placed by their ink (words.ts).
// 6. Boxes found on a page that was turned are turned back, so every place is in the original's pixels.

import { decode, LINE_HEIGHT, SLICE, sureOf, textOf } from "./ctc";
import { linesIn, READING, scaleFor, stitch, tiles, type Found } from "./detect";
import { cut, halfTurn, HALVES, IMAGENET, place, shrink, turn, type Pixels, type Point, type Slanted } from "./pixels";
import { cutSize, wordsOf, type Line } from "./words";

/** The models, as four calls: each takes a model's input, channels first, and gives its answer. */
export interface Models {
    /** The detector: a picture `width` by `height` (multiples of 32) in, the map of the same size out. */
    detect(input: Float32Array, width: number, height: number): Promise<Float32Array>;
    /** The recognizer: `batch` lines `width` wide and 48 high in, `frames` slices of `classes` likelihoods for each out. */
    recognize(input: Float32Array, batch: number, width: number): Promise<{ data: Float32Array; frames: number; classes: number }>;
    /** Whether lines are upside down: `batch` lines 160 by 80 in, two likelihoods for each out (right way up, upside down). */
    line?(input: Float32Array, batch: number): Promise<Float32Array>;
    /** Whether the page is turned: one picture 224 square in, four likelihoods out (upright, a quarter, a half, three quarters). */
    page?(input: Float32Array): Promise<Float32Array>;
}

/** What a reading needs besides the picture and the models. */
export interface ReadOptions {
    /** The recognizer's characters, the blank first (dictionary.ts). */
    dictionary: string[];
    /** How sure the detector must be of a line (the tier's). */
    sure: number;
    /** Told how far the reading has gone, from 0 to 1. */
    progress?(done: number): void;
    /** Asked between steps; true stops the reading. */
    stopped?(): boolean;
}

/** How sure an orientation model must be before a page or a line is turned. */
export const TURN_SURE = 0.85;
/** Lines read in one go by the recognizer. */
export const BATCH = 8;
/** The narrowest a batch of lines is given to the recognizer, as PaddleOCR gives it. */
export const NARROWEST = 320;

/** The index of the largest of `count` numbers from `offset`. */
const largest = (values: Float32Array, offset: number, count: number) => {
    let best = 0;
    for (let at = 1; at < count; at++) if (values[offset + at]! > values[offset + best]!) best = at;
    return best;
};

/** A box found on the picture turned clockwise `quarters` times, taken back to the picture as it was (`width` by `height`). */
export function unturn(box: Slanted, quarters: number, width: number, height: number): Slanted {
    const q = ((quarters % 4) + 4) % 4;
    const point = (at: Point): Point => (q === 1 ? { x: at.y, y: height - at.x } : q === 2 ? { x: width - at.x, y: height - at.y } : q === 3 ? { x: width - at.y, y: at.x } : at);
    const vector = (at: Point): Point => (q === 1 ? { x: at.y, y: -at.x } : q === 2 ? { x: -at.x, y: -at.y } : q === 3 ? { x: -at.y, y: at.x } : at);
    return { ...box, at: point(box.at), along: vector(box.along) };
}

/** Which way the page is turned, in clockwise quarters to turn it upright, by the page model; 0 when it is not sure. */
async function pageTurn(picture: Pixels, models: Models): Promise<number> {
    if (!models.page) return 0;
    // the shorter side made 256, then the middle 224 square, as the model's file says
    const scale = 256 / Math.min(picture.width, picture.height);
    const small = shrink(picture, Math.max(224, Math.round(picture.width * Math.min(1, scale))), Math.max(224, Math.round(picture.height * Math.min(1, scale))));
    const input = new Float32Array(3 * 224 * 224);
    place(small, input, 0, 224, 224, IMAGENET, { x: Math.max(0, Math.floor((small.width - 224) / 2)), y: Math.max(0, Math.floor((small.height - 224) / 2)), width: 224, height: 224 });
    const answer = await models.page(input);
    const best = largest(answer, 0, 4);
    // the model says how far the page was turned; turning it back is the rest of the way round
    return best && answer[best]! >= TURN_SURE ? (4 - best) % 4 : 0;
}

/** Reads the picture's text: its lines, in reading order, each with its words, every box in the picture's own pixels. */
export async function readText(picture: Pixels, models: Models, options: ReadOptions): Promise<Line[]> {
    const quarters = await pageTurn(picture, models);
    const upright = turn(picture, quarters);
    const scale = scaleFor(upright.width, upright.height);
    const seen = scale < 1 ? shrink(upright, Math.round(upright.width * scale), Math.round(upright.height * scale)) : upright;
    const parts = tiles(seen.width, seen.height);
    const map = new Uint8Array(seen.width * seen.height);
    let steps = parts.length;
    let done = 0;
    const went = () => options.progress?.(Math.min(1, ++done / steps));
    for (const tile of parts) {
        if (options.stopped?.()) return [];
        const input = new Float32Array(3 * tile.inWidth * tile.inHeight);
        place(seen, input, 0, tile.inWidth, tile.inHeight, IMAGENET, tile);
        stitch(map, seen.width, tile, await models.detect(input, tile.inWidth, tile.inHeight));
        went();
    }
    const found: Found[] = linesIn(map, seen.width, seen.height, { ...READING, sure: options.sure }).map((line) => ({ ...line, box: { ...line.box, at: { x: line.box.at.x / scale, y: line.box.at.y / scale }, length: line.box.length / scale, height: line.box.height / scale } }));
    const cuts = found.map((line) => {
        const size = cutSize(line.box);
        return { line, size, crop: cut(upright, line.box, size.width, LINE_HEIGHT), turned: false };
    });
    steps += Math.ceil(cuts.length / BATCH) * (models.line ? 2 : 1);

    // lines upside down are turned the right way up, by the line model at 160 by 80
    if (models.line) {
        for (let start = 0; start < cuts.length; start += BATCH) {
            if (options.stopped?.()) return [];
            const batch = cuts.slice(start, start + BATCH);
            const input = new Float32Array(batch.length * 3 * 80 * 160);
            batch.forEach((each, index) => place(cut(upright, each.line.box, 160, 80), input, index, 160, 80, IMAGENET));
            const answer = await models.line(input, batch.length);
            batch.forEach((each, index) => {
                if (largest(answer, index * 2, 2) === 1 && answer[index * 2 + 1]! >= TURN_SURE) {
                    each.crop = halfTurn(each.crop);
                    each.turned = true;
                }
            });
            went();
        }
    }

    // read the narrowest together, so a batch's padding is least
    const order = cuts.map((_, index) => index).sort((a, b) => cuts[a]!.size.width - cuts[b]!.size.width);
    const lines: (Line | undefined)[] = new Array(cuts.length);
    for (let start = 0; start < order.length; start += BATCH) {
        if (options.stopped?.()) return [];
        const batch = order.slice(start, start + BATCH).map((index) => ({ index, ...cuts[index]! }));
        const width = Math.max(NARROWEST, Math.ceil(Math.max(...batch.map((each) => each.size.width)) / SLICE) * SLICE);
        const input = new Float32Array(batch.length * 3 * LINE_HEIGHT * width);
        batch.forEach((each, at) => place(each.crop, input, at, width, LINE_HEIGHT, HALVES));
        const answer = await models.recognize(input, batch.length, width);
        batch.forEach((each, at) => {
            const characters = decode(answer.data, answer.frames, answer.classes, options.dictionary, at * answer.frames * answer.classes, Math.ceil((each.size.width * answer.frames) / width));
            const text = textOf(characters).trim();
            if (!text) return;
            const words = wordsOf(characters, each.crop, each.line.box, each.turned, 0);
            lines[each.index] = { text, box: each.line.box, sure: sureOf(characters), words };
        });
        went();
    }
    // numbered in reading order, and taken back from an upright page to the picture as it came
    const kept = lines.filter((line): line is Line => !!line);
    options.progress?.(1);
    return kept.map((line, index) => ({
        ...line,
        box: unturn(line.box, quarters, picture.width, picture.height),
        words: line.words.map((word) => ({ ...word, line: index, box: unturn(word.box, quarters, picture.width, picture.height) })),
    }));
}
