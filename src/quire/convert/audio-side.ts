// The sounds' group of the converter's column: the format (WAV and FLAC written by hand, Opus in WebM or
// Ogg and AAC in M4A by the browser's own encoder, each offered only where this browser has it, and
// said so where it has not), the rate, the channels, the rate of bits where it means something, and the bits
// of a WAV or FLAC. MP3 is read and never written, and the column says why.

import { group } from "../core/bench";
import { make } from "../core/ui";
import { AUDIO_DEFAULT, AUDIO_FORMATS, audioAbilities, decodeSound, encodeSound, NO_MP3, soundFacts, type AudioChoice, type AudioFormat } from "./audio";
import type { Found } from "./kinds";
import { timeSaid } from "./names";
import { choices, fold, note, unit, type Becoming, type Item, type Made, type Side } from "./parts";

/** A rate as a person reads it: "48 kHz", "44.1 kHz". */
export const rateSaid = (rate: number) => `${Math.round(rate / 100) / 10} kHz`;

/** Channels as a person reads them. */
export const channelsSaid = (channels: number) => (channels === 1 ? "mono" : channels === 2 ? "stereo" : `${channels} channels`);

/** What a sound's row says it is: its kind, rate, channels and length, as far as its header says them. */
export function soundWords(label: string, facts: { rate?: number; channels?: number; duration?: number } | undefined): string {
    const shape = [facts?.rate ? rateSaid(facts.rate) : "", facts?.channels ? channelsSaid(facts.channels) : ""].filter(Boolean).join(" ");
    return [label, shape, facts?.duration ? timeSaid(facts.duration) : ""].filter(Boolean).join(", ");
}

/** The rate and channels a sound is written at: Opus always at 48 kHz and at most in stereo, AAC at most in stereo. */
export function shapeFor(choice: AudioChoice, came: { rate?: number; channels?: number } | undefined): { rate: number; channels: number } {
    const opus = choice.format === "opus-webm" || choice.format === "opus-ogg";
    const rate = opus ? 48_000 : choice.rate || came?.rate || 48_000;
    let channels = choice.channels;
    if (!channels && (opus || choice.format === "aac-m4a") && (came?.channels ?? 2) > 2) channels = 2;
    if (!channels && choice.format === "flac" && (came?.channels ?? 2) > 8) channels = 2;
    return { rate, channels };
}

/** The sounds' group of the column. */
export function audioSide(): Side {
    const choice: AudioChoice = { ...AUDIO_DEFAULT };
    const facts = new WeakMap<Blob, Awaited<ReturnType<typeof soundFacts>>>();
    let abilities = { opus: false, aac: false, asked: false };
    const side: Side = {
        kind: "audio",
        element: make("div"),
        lane: "audio",
        async identify(item: Item): Promise<Found | undefined> {
            const found = await soundFacts(item.file).catch(() => undefined);
            facts.set(item.file, found);
            return { ...item.found, label: soundWords(item.found.label, found) };
        },
        becomes(item: Item): Becoming {
            const format = AUDIO_FORMATS.find((each) => each.key === choice.format)!;
            const cannot = cannotOf(format.key);
            if (cannot) return { cannot };
            const { rate } = shapeFor(choice, facts.get(item.file));
            return { label: `${format.label}${choice.rate || format.key.startsWith("opus") ? `, ${rateSaid(rate)}` : ""}${choice.channels ? `, ${channelsSaid(choice.channels)}` : ""}`, ending: format.ending };
        },
        async run(item: Item, signal, told): Promise<Made> {
            const now = { ...choice };
            const format = AUDIO_FORMATS.find((each) => each.key === now.format)!;
            const shape = shapeFor(now, facts.get(item.file));
            told(0, "Reading");
            const buffer = await decodeSound(item.file, shape.rate, shape.channels, signal);
            told(0, `Writing ${format.label}`);
            const blob = await encodeSound(buffer, now, signal, (share) => told(share, `Writing ${format.label}`));
            const notes: string[] = [];
            const came = facts.get(item.file);
            if (came?.channels && came.channels > 2 && buffer.numberOfChannels === 2 && !now.channels) notes.push(`Mixed from ${came.channels} channels to stereo, as ${format.label} is written here with two at most.`);
            return { blob, became: `${format.label}, ${rateSaid(buffer.sampleRate)} ${channelsSaid(buffer.numberOfChannels)}, ${timeSaid(buffer.duration)}`, notes };
        },
    };
    const changed = () => side.changed?.();
    const cannotOf = (format: AudioFormat): string | undefined => {
        if (!abilities.asked && format !== "wav" && format !== "flac") return "Asking this browser what it can write.";
        if ((format === "opus-webm" || format === "opus-ogg") && !abilities.opus) return "This browser cannot write Opus.";
        if (format === "aac-m4a" && !abilities.aac) return "This browser cannot write AAC.";
        return undefined;
    };
    const formatOptions = () => AUDIO_FORMATS.map((each) => ({ value: each.key, label: each.short.toLowerCase(), tip: `${each.label}: ${each.tip}`, cannot: cannotOf(each.key) }));
    const formats = choices<AudioFormat>("into", formatOptions(), choice.format, (value) => {
        choice.format = value;
        fill();
        changed();
    });
    const canSay = note();
    const rateOptions = (opus: boolean) => [0, 48_000, 44_100, 32_000, 24_000, 16_000].map((rate) => ({ value: String(rate), label: rate ? rateSaid(rate) : "as it came", cannot: opus && rate !== 48_000 && rate !== 0 ? "Opus is always 48 kHz." : undefined }));
    const rates = choices<string>("rate", rateOptions(false), "0", (value) => ((choice.rate = Number(value)), changed()));
    const channels = choices<string>("channels", [{ value: "0", label: "as it came" }, { value: "2", label: "stereo" }, { value: "1", label: "mono" }], "0", (value) => ((choice.channels = Number(value)), changed()));
    const bitrates = choices<string>(
        "bitrate",
        [64, 96, 128, 160, 192, 256].map((rate) => ({ value: String(rate * 1000), label: `${rate}`, tip: `${rate} kilobits a second` })),
        String(choice.bitrate),
        (value) => ((choice.bitrate = Number(value)), changed()),
        unit("kbps"),
    );
    const bitsOptions = (flac: boolean) => [{ value: "16", label: "16" }, { value: "24", label: "24" }, { value: "32", label: "32 float", tip: "Floating point, for further work", cannot: flac ? "FLAC is written in 16 or 24 bits." : undefined }];
    const bits = choices<string>("bits", bitsOptions(false), "16", (value) => ((choice.bits = Number(value) as 16 | 24 | 32), changed()));
    const rateNote = note();
    const lossyFold = fold(bitrates.element);
    const bitsFold = fold(bits.element);
    function fill() {
        const format = AUDIO_FORMATS.find((each) => each.key === choice.format)!;
        lossyFold.open(format.lossy);
        bitsFold.open(!format.lossy);
        const opus = format.key.startsWith("opus");
        rates.bar(rateOptions(opus));
        rateNote.say(opus ? "Opus is always 48 kHz." : "");
        bits.bar(bitsOptions(format.key === "flac"));
        if (format.key === "flac" && choice.bits === 32) {
            choice.bits = 24;
            bits.set("24");
        }
        formats.bar(formatOptions());
        const missing = [!abilities.opus && "Opus", !abilities.aac && "AAC"].filter(Boolean);
        canSay.say(abilities.asked && missing.length ? `This browser cannot write ${missing.join(" or ")}, so ${missing.length > 1 ? "they are" : "it is"} not offered here.` : "");
    }
    side.element = group("sounds", formats.element, canSay, note(NO_MP3), rates.element, rateNote, channels.element, lossyFold.element, bitsFold.element);
    side.element.dataset.kind = "audio";
    fill();
    void audioAbilities().then((found) => {
        abilities = { ...found, asked: true };
        fill();
        changed();
    });
    return side;
}
