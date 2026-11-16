// What a file is, found from its first bytes before its name: a picture, text or data, a sound, or a
// film, and its format. The first bytes win over the ending, since a file is often named wrongly (a
// PNG saved as .jpg, a phone's HEIC as .jpeg). An MP4 or a WebM can hold a film or only a sound; the
// brand tells an M4A apart here, and the page asks the container itself for the rest (a WebM of only
// sound is found when its tracks are read).
//
//   kindOf(firstBytes, "photo.jpg", "image/jpeg")   { kind: "picture", format: "jpeg", label: "JPEG picture" }

/** The four kinds the converter works on, and what it cannot. */
export type Kind = "picture" | "text" | "audio" | "video" | "unknown";

/** What a file was found to be: its kind, a short key for its format, and the words for it. */
export interface Found {
    kind: Kind;
    format: string;
    label: string;
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const starts = (bytes: Uint8Array, ...values: number[]) => values.every((value, at) => bytes[at] === value);

/** The words for each format found, by its key. */
export const FORMAT_WORDS: Record<string, string> = {
    png: "PNG picture",
    jpeg: "JPEG picture",
    gif: "GIF picture",
    webp: "WebP picture",
    avif: "AVIF picture",
    heic: "HEIC picture",
    jxl: "JPEG XL picture",
    bmp: "BMP picture",
    tiff: "TIFF picture",
    svg: "SVG picture",
    ico: "Icon",
    wav: "WAV sound",
    flac: "FLAC sound",
    ogg: "Ogg sound",
    opus: "Opus sound",
    mp3: "MP3 sound",
    m4a: "M4A sound",
    aac: "AAC sound",
    aiff: "AIFF sound",
    mp4: "MP4 film",
    mov: "QuickTime film",
    webm: "WebM film",
    mkv: "Matroska film",
    md: "Markdown",
    html: "HTML",
    csv: "CSV",
    json: "JSON",
    yaml: "YAML",
    toml: "TOML",
    text: "Text",
};

const found = (kind: Kind, format: string): Found => ({ kind, format, label: FORMAT_WORDS[format] ?? format.toUpperCase() });

/** The brands of an ISO base media file that say it is a still picture, and which one. */
const PICTURE_BRANDS: Record<string, string> = { avif: "avif", avis: "avif", heic: "heic", heix: "heic", heim: "heic", heis: "heic", hevc: "heic", hevx: "heic", mif1: "heic", msf1: "heic" };

/** What the endings say, for files whose first bytes say nothing (text, and sounds with no header). */
const ENDINGS: Record<string, Found> = {
    md: found("text", "md"),
    markdown: found("text", "md"),
    mdown: found("text", "md"),
    html: found("text", "html"),
    htm: found("text", "html"),
    csv: found("text", "csv"),
    tsv: found("text", "csv"),
    json: found("text", "json"),
    yaml: found("text", "yaml"),
    yml: found("text", "yaml"),
    toml: found("text", "toml"),
    txt: found("text", "text"),
    aac: found("audio", "aac"),
    mp3: found("audio", "mp3"),
    svg: found("picture", "svg"),
};

/**
 * What a file is, from its first bytes (64 are enough), its name and the type the browser gave it.
 * An ISO base media file with a brand of sound only (M4A) is a sound; any other is a film until its
 * tracks say otherwise.
 */
export function kindOf(head: Uint8Array, name = "", type = ""): Found {
    const ending = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
    if (starts(head, 0x89, 0x50, 0x4e, 0x47)) return found("picture", "png");
    if (starts(head, 0xff, 0xd8, 0xff)) return found("picture", "jpeg");
    if (ascii(head, 0, 4) === "GIF8") return found("picture", "gif");
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return found("picture", "webp");
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return found("audio", "wav");
    if (ascii(head, 0, 4) === "RF64" && ascii(head, 8, 12) === "WAVE") return found("audio", "wav");
    if (ascii(head, 0, 4) === "FORM" && (ascii(head, 8, 12) === "AIFF" || ascii(head, 8, 12) === "AIFC")) return found("audio", "aiff");
    if (starts(head, 0xff, 0x0a) || (ascii(head, 4, 8) === "JXL " && starts(head, 0, 0, 0, 0x0c))) return found("picture", "jxl");
    if (ascii(head, 0, 2) === "BM" && head.length > 14) return found("picture", "bmp");
    if (starts(head, 0x49, 0x49, 0x2a, 0) || starts(head, 0x4d, 0x4d, 0, 0x2a)) return found("picture", "tiff");
    if (starts(head, 0, 0, 1, 0) && ending === "ico") return found("picture", "ico");
    if (ascii(head, 0, 4) === "fLaC") return found("audio", "flac");
    if (ascii(head, 0, 4) === "OggS") {
        // the first page's packet names its codec: OpusHead, a Vorbis header, or a FLAC mapping
        const first = ascii(head, 28, 36);
        return first.startsWith("OpusHead") ? found("audio", "opus") : found("audio", "ogg");
    }
    if (ascii(head, 0, 3) === "ID3") return found("audio", "mp3");
    if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
        // an MPEG audio frame, or an AAC stream in ADTS (layer bits 00 and the sync of twelve bits)
        return (head[1]! & 0xf6) === 0xf0 ? found("audio", "aac") : found("audio", "mp3");
    }
    if (starts(head, 0x1a, 0x45, 0xdf, 0xa3)) {
        // the document type, a few bytes in: webm or matroska
        const text = ascii(head, 0, Math.min(head.length, 64));
        return text.includes("webm") ? found(ending === "weba" || type.startsWith("audio/") ? "audio" : "video", "webm") : found(ending === "mka" || type.startsWith("audio/") ? "audio" : "video", "mkv");
    }
    if (ascii(head, 4, 8) === "ftyp") {
        const major = ascii(head, 8, 12);
        const size = Math.min(head.length, new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0));
        const brands = [major];
        for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(head, at, at + 4));
        // a still picture's major brand is its own; a film's is one of a film's, whatever else it lists
        const picture = PICTURE_BRANDS[major] ?? (["isom", "mp41", "mp42", "avc1", "dash", "iso5", "iso6", "qt  ", "M4A "].includes(major) ? undefined : brands.map((brand) => PICTURE_BRANDS[brand]).find(Boolean));
        if (picture) return found("picture", picture);
        if (major === "M4A " || major === "M4B " || major === "M4P " || ending === "m4a" || type.startsWith("audio/")) return found("audio", "m4a");
        if (major === "qt  ") return found("video", "mov");
        return found("video", "mp4");
    }
    if (ENDINGS[ending]) return ENDINGS[ending]!;
    if (/^image\//.test(type)) return found("picture", type.slice(6).replace(/^x-/, ""));
    if (/^(text\/|application\/(json|toml|yaml|x-yaml))/.test(type) || looksLikeText(head)) return found("text", "text");
    return found("unknown", ending || "file");
}

/** True when the bytes read as UTF-8 text with no control characters but tabs and line ends. */
export function looksLikeText(head: Uint8Array): boolean {
    if (!head.length) return false;
    for (const byte of head) if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) return false;
    try {
        // a character cut at the end of the bytes read is no sign of anything
        new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)));
        return true;
    } catch {
        return false;
    }
}
