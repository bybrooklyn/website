// The films' group of the converter's column: what a film becomes (MP4 with H.264, or WebM with VP9 or
// AV1, each offered only where this browser writes it, and said so where it does not), a smaller size,
// and a lower bitrate. A film's row says what it holds when it arrives: its pictures' coding and size,
// its sound, its length; a file of only sound found in a film's container is passed to the sounds.

import { group } from "../core/bench";
import { make } from "../core/ui";
import type { Found } from "./kinds";
import { timeSaid } from "./names";
import { choices, note, unit, type Becoming, type Item, type Made, type Side } from "./parts";
import { convertFilm, FILM_DEFAULT, filmAbilities, openFilm, type FilmChoice } from "./video";

/** The ways a film can be written, as the column offers them. */
export const FILM_FORMATS: { key: string; label: string; format: FilmChoice["format"]; video: FilmChoice["video"]; coding: "h264" | "vp9" | "av1"; ending: string; tip: string }[] = [
    { key: "mp4", label: "MP4", format: "mp4", video: "vp9", coding: "h264", ending: ".mp4", tip: "H.264, played by nearly everything" },
    { key: "webm-vp9", label: "WebM VP9", format: "webm", video: "vp9", coding: "vp9", ending: ".webm", tip: "VP9 with Opus, smaller than H.264, played by browsers" },
    { key: "webm-av1", label: "WebM AV1", format: "webm", video: "av1", coding: "av1", ending: ".webm", tip: "AV1 with Opus, the smallest, slower to make" },
];

/** What a film's row says it holds: its container, its pictures' coding and size, its sound and its length. */
export function filmWords(label: string, film: { tracks: { kind: string; label: string; width?: number; height?: number }[]; duration: number }): string {
    const picture = film.tracks.find((track) => track.kind === "video");
    const sound = film.tracks.find((track) => track.kind === "audio");
    const parts = [label];
    if (picture) parts.push(`${picture.label} ${picture.width} × ${picture.height}`);
    parts.push(sound ? `${sound.label} sound` : "no sound");
    if (film.duration) parts.push(timeSaid(film.duration));
    return parts.join(", ");
}

/** The films' group of the column. */
export function videoSide(): Side {
    let key = "mp4";
    const choice: FilmChoice = { ...FILM_DEFAULT };
    let abilities = { h264: false, vp9: false, av1: false, aac: false, opus: false, asked: false };
    const side: Side = {
        kind: "video",
        element: make("div"),
        lane: "video",
        async identify(item: Item): Promise<Found | undefined> {
            try {
                const film = await openFilm(item.file);
                if (!film.tracks.some((track) => track.kind === "video") && film.tracks.some((track) => track.kind === "audio")) return { kind: "audio", format: item.found.format, label: `${item.found.label.replace(/ film$/, "")} sound` };
                return { ...item.found, label: filmWords(item.found.label, film) };
            } catch (error) {
                return { ...item.found, label: `${item.found.label}, ${error instanceof Error ? error.message : "not read"}` };
            }
        },
        becomes(): Becoming {
            const format = FILM_FORMATS.find((each) => each.key === key)!;
            const cannot = cannotOf(format.coding);
            if (cannot) return { cannot };
            return { label: `${format.label}${choice.height ? `, ${choice.height}p at most` : ""}${choice.bitrate ? `, ${choice.bitrate / 1_000_000} Mbps` : ""}`, ending: format.ending };
        },
        async run(item: Item, signal, told): Promise<Made> {
            told(0, "Reading");
            const format = FILM_FORMATS.find((each) => each.key === key)!;
            const done = await convertFilm(item.file, { ...choice }, signal, told);
            return { blob: done.blob, became: `${format.label}, ${done.facts}`, notes: done.notes };
        },
    };
    const changed = () => side.changed?.();
    const cannotOf = (coding: "h264" | "vp9" | "av1"): string | undefined => {
        if (!abilities.asked) return "Asking this browser what it can write.";
        if (!abilities[coding]) return `This browser cannot write ${coding === "h264" ? "H.264" : coding === "vp9" ? "VP9" : "AV1"} film.`;
        return undefined;
    };
    const options = () => FILM_FORMATS.map((each) => ({ value: each.key, label: each.label.toLowerCase(), tip: each.tip, cannot: cannotOf(each.coding) }));
    const formats = choices<string>("into", options(), key, (value) => {
        key = value;
        const format = FILM_FORMATS.find((each) => each.key === value)!;
        choice.format = format.format;
        choice.video = format.video;
        fill();
        changed();
    });
    const sizes = choices<string>(
        "size",
        [0, 1080, 720, 480, 360].map((height) => ({ value: String(height), label: height ? `${height}p` : "as it came", tip: height ? `No taller than ${height} pixels; a smaller film is left as it is` : undefined })),
        "0",
        (value) => ((choice.height = Number(value)), changed()),
    );
    const bitrates = choices<string>(
        "bitrate",
        [0, 8_000_000, 4_000_000, 2_000_000, 1_000_000, 500_000].map((rate) => ({ value: String(rate), label: rate ? `${rate / 1_000_000}` : "auto", tip: rate ? `${rate / 1_000_000} megabits a second` : "Worked out from the size: about a tenth of a bit for each pixel shown" })),
        "0",
        (value) => ((choice.bitrate = Number(value)), changed()),
        unit("Mbps"),
    );
    const canSay = note();
    const soundSay = note();
    function fill() {
        formats.bar(options());
        const missing = [!abilities.h264 && "H.264", !abilities.vp9 && "VP9", !abilities.av1 && "AV1"].filter(Boolean);
        canSay.say(abilities.asked && missing.length ? `This browser cannot write ${missing.join(" or ")} film, so ${missing.length > 1 ? "they are" : "it is"} not offered here.` : "");
        soundSay.say(abilities.asked && choice.format === "mp4" && !abilities.aac ? "This browser cannot write AAC, so sound that must be encoded again goes into an MP4 as Opus. AAC and Opus sound is carried over as it is." : "Sound is carried over as it is where the new file holds it, and encoded again otherwise.");
    }
    side.element = group("films", formats.element, canSay, sizes.element, bitrates.element, soundSay);
    side.element.dataset.kind = "video";
    fill();
    void filmAbilities().then((found) => {
        abilities = { ...found, asked: true };
        fill();
        changed();
    });
    return side;
}
