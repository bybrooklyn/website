// The pictures' side of the converter's panel: the format (imgQuire's, those that lose a little then those that
// keep every pixel), the quality or a weight to come in under, the size (as it came, a largest side, or
// a share), and what of the metadata goes with it, in imgQuire's words. A picture the browser cannot
// read (a TIFF in Chromium, say) is said so in its row when it is tried.

import { make } from "../core/ui";
import { readWeight, sizeSaid } from "./names";
import { choices, fold, line, note, numberField, section, type Becoming, type Item, type Made, type Side } from "./parts";
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

/** The pictures' side of the panel, working through imgQuire's engine. */
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
    for (const list of [lossyFormats, losslessFormats]) formatRows.push(choices("Format", list.map((each) => ({ value: each.key, label: each.label.replace(/ lossless$/, ""), tip: each.tip })), choice.format, pick));

    const quality = make("input", "quire-convert-range");
    quality.type = "range";
    quality.min = "5";
    quality.max = "100";
    quality.value = String(Math.round(choice.quality * 100));
    quality.setAttribute("aria-label", "Quality");
    const qualityShown = make("output", "quire-convert-value", quality.value);
    quality.addEventListener("input", () => {
        choice.quality = Number(quality.value) / 100;
        qualityShown.textContent = quality.value;
        changed();
    });
    const under = make("input", "quire-convert-field quire-convert-under");
    under.placeholder = "No limit";
    under.setAttribute("aria-label", "Under");
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
    const qualityLine = line("Quality", quality, qualityShown);
    qualityLine.classList.add("with-value");
    const lossyFold = fold(qualityLine, line("Under", under), underSaid);
    function fillQuality() {
        const lossy = engine.formats.find((each) => each.key === choice.format)!.lossy;
        lossyFold.open(lossy);
        quality.disabled = !!choice.target;
    }

    const longest = numberField("Largest side", "px", 2048, { least: 16, most: 16384 }, (value) => ((choice.size = { by: "side", value }), changed()));
    const share = numberField("Percent of its size", "%", 50, { least: 1, most: 100 }, (value) => ((choice.size = { by: "percent", value }), changed()));
    const sideFold = fold(longest.element);
    const shareFold = fold(share.element);
    const sizes = choices<"same" | "side" | "percent">(
        "Size",
        [
            { value: "same", label: "As it came" },
            { value: "side", label: "Largest side", tip: "No side longer than this; a smaller picture is left as it is" },
            { value: "percent", label: "Percent" },
        ],
        "same",
        (value) => {
            choice.size = value === "same" ? { by: "same" } : value === "side" ? { by: "side", value: Number(longest.input.value) || 2048 } : { by: "percent", value: Number(share.input.value) || 50 };
            sideFold.open(value === "side");
            shareFold.open(value === "percent");
            changed();
        },
    );
    const keeps = choices<Keep>("Metadata", KEEPS.map((each) => ({ value: each.key, label: each.label, tip: each.tip })), choice.keep, (value) => ((choice.keep = value), changed()));

    side.element = section(
        "Pictures",
        line("Lossy", formatRows[0]!.element),
        line("Lossless", formatRows[1]!.element),
        lossyFold.element,
        line("Size", sizes.element),
        sideFold.element,
        shareFold.element,
        line("Metadata", keeps.element),
    );
    side.element.dataset.kind = "picture";
    fillQuality();
    return side;
}
