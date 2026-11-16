// The pictures' group of the converter's column: the format (imgQuire's, those that lose a little then those that
// keep every pixel), the quality or a weight to come in under, the size (as it came, a largest side, or
// a share), and what of the metadata goes with it, in imgQuire's words. A picture the browser cannot
// read (a TIFF in Chromium, say) is said so in its row when it is tried.

import { group, lowered, slide, typed } from "../core/bench";
import { make } from "../core/ui";
import { readWeight, sizeSaid } from "./names";
import { choices, fold, note, numberField, type Becoming, type Item, type Made, type Side } from "./parts";
import { attemptsFor, convertPicture, type Keep, type PictureChoice, type PictureEngine } from "./pictures";

/** What of a picture's metadata goes with it, as imgQuire's export says it. */
export const KEEPS: { key: Keep; label: string; tip: string }[] = [
    { key: "none", label: "None", tip: "Nothing about the picture goes with it" },
    { key: "noplace", label: "No place", tip: "Camera, date and the rest, but not where it was taken" },
    { key: "all", label: "All", tip: "Everything the picture says about itself, where it was taken too" },
];

/** What a picture becomes when nothing has been chosen: WebP at 85, as imgQuire's export, at its own size, with nothing about it kept. */
export const PICTURE_DEFAULT: PictureChoice = { format: "webp", quality: 0.85, size: { by: "same" }, keep: "none" };

/** The words for what a picture becomes: its format, and its size when it is made smaller. */
export function pictureWords(choice: PictureChoice, label: string): string {
    const size = choice.size.by === "side" ? `, ${choice.size.value} px at most` : choice.size.by === "percent" && choice.size.value < 100 ? `, ${choice.size.value}%` : "";
    return `${label}${size}`;
}

/** The pictures' group of the column, working through imgQuire's engine. */
export function pictureSide(engine: PictureEngine): Side {
    const choice: PictureChoice = { ...PICTURE_DEFAULT };
    const side: Side = {
        kind: "picture",
        element: make("div"),
        lane: "picture",
        becomes(): Becoming {
            const format = engine.formats.find((each) => each.key === choice.format)!;
            return { label: pictureWords(choice, format.label), ending: format.ending };
        },
        async run(item: Item, signal, told): Promise<Made> {
            const now = { ...choice, size: { ...choice.size } } as PictureChoice;
            const format = engine.formats.find((each) => each.key === now.format)!;
            const attempts = attemptsFor(now, format.lossy);
            told(0, "Reading");
            const done = await convertPicture(item.file, engine, now, signal, (share) => told(share, share < 1 / (1 + attempts) + 0.001 ? "Reading" : attempts > 1 ? "Finding the quality" : `Writing ${format.label}`));
            const facts = [done.from.width === done.width && done.from.height === done.height ? `${done.width} × ${done.height}` : `${done.from.width} × ${done.from.height} to ${done.width} × ${done.height}`];
            if (format.lossy && now.target) facts.push(`quality ${Math.round(done.quality * 100)}`);
            return { blob: done.blob, facts: facts.join(", "), notes: done.notes };
        },
    };
    const changed = () => side.changed?.();

    const lossyFormats = engine.formats.filter((each) => each.lossy);
    const losslessFormats = engine.formats.filter((each) => !each.lossy);
    const formatRows: ReturnType<typeof choices<string>>[] = [];
    const pick = (value: string) => {
        choice.format = value;
        for (const row of formatRows) row.set(value);
        fillQuality();
        changed();
    };
    for (const [label, list] of [["lossy", lossyFormats], ["lossless", losslessFormats]] as const) formatRows.push(choices(label, list.map((each) => ({ value: each.key, label: each.label.replace(/ lossless$/, ""), tip: each.tip })), choice.format, pick));

    const quality = slide("quality", { min: 5, max: 100 }, (value) => {
        choice.quality = value / 100;
        changed();
    });
    quality.set(Math.round(choice.quality * 100));
    // the weight is read when it is left or Enter is pressed, so that a half typed weight is not refused
    const underLine = typed("under", () => {}, { hint: "No limit" });
    const under = underLine.input as HTMLInputElement;
    const underSaid = note();
    const readUnder = () => {
        const target = readWeight(under.value);
        if (under.value.trim() && !target) underSaid.say("Type a weight such as 200 KB or 1.5 MB.");
        else underSaid.say(target ? `The highest quality under ${sizeSaid(target)} is searched for.` : "");
        choice.target = target;
        if (target) under.value = sizeSaid(target);
        fillQuality();
        changed();
    };
    under.addEventListener("change", readUnder);
    under.addEventListener("keydown", (event) => event.key === "Enter" && readUnder());
    const lossyFold = fold(quality.row, underLine.row, underSaid);
    function fillQuality() {
        const lossy = engine.formats.find((each) => each.key === choice.format)!.lossy;
        lossyFold.open(lossy);
        quality.input.disabled = !!choice.target;
    }

    const longest = numberField("largest side", "px", 2048, { least: 16, most: 16384 }, (value) => ((choice.size = { by: "side", value }), changed()));
    const share = numberField("percent", "%", 50, { least: 1, most: 100 }, (value) => ((choice.size = { by: "percent", value }), changed()));
    const sideFold = fold(longest.element);
    const shareFold = fold(share.element);
    const sizes = choices<"same" | "side" | "percent">(
        "size",
        [
            { value: "same", label: "as it came" },
            { value: "side", label: "largest side", tip: "No side longer than this; a smaller picture is left as it is" },
            { value: "percent", label: "percent" },
        ],
        "same",
        (value) => {
            choice.size = value === "same" ? { by: "same" } : value === "side" ? { by: "side", value: Number(longest.input.value) || 2048 } : { by: "percent", value: Number(share.input.value) || 50 };
            sideFold.open(value === "side");
            shareFold.open(value === "percent");
            changed();
        },
    );
    const keeps = choices<Keep>("metadata", KEEPS.map((each) => ({ value: each.key, label: lowered(each.label), tip: each.tip })), choice.keep, (value) => ((choice.keep = value), changed()));

    side.element = group("pictures", formatRows[0]!.element, formatRows[1]!.element, lossyFold.element, sizes.element, sideFold.element, shareFold.element, keeps.element);
    side.element.dataset.kind = "picture";
    fillQuality();
    return side;
}
