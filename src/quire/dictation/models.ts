// The speech models dictation can use, in one small table. Pointing a tier at files made some other
// way is a change to its row: the repository the files are fetched from, and the path and size of
// each file in it. How a model is made and what the engine needs of it is in MODELS.md.
//
// Three tiers, a different kind of model in each:
//   light  Parakeet Redux, a 0.6 billion parameter transducer with a ternary encoder, for desktops and laptops
//   main   Parakeet Ultra, the same network trained further, the most accurate (the panel calls it "Accurate")
//   tiny   Moonshine tiny, 27 million parameters, for phones and slow connections
//
// A Parakeet encoder runs on the graphics card only if it is a 4-bit one (w4a8), and only Ultra has
// such a file. So Ultra uses it on the card and on the processor alike: it is as fast and as accurate
// on the processor as the 8-bit file and 270 MB smaller. Redux's 2-bit encoder runs on the processor.

/** The engine that runs a tier's files: parakeet/ (our own) or moonshine.ts. */
export type Engine = "parakeet" | "moonshine";

/** What a file is for. */
export type Role = "encoder" | "decoder" | "vocab" | "tokenizer";

/** One file of a model: its place in the repository and its size in bytes. */
export interface ModelFile {
    role: Role;
    path: string;
    bytes: number;
}

/** A tier of the model list. */
export interface Tier {
    id: "main" | "light" | "tiny";
    name: string;
    /** One line for the panel on what it is good for. */
    note: string;
    engine: Engine;
    /** The Hugging Face repository the files come from. */
    repo: string;
    files: ModelFile[];
    license: string;
    /** Who made it, as the panel and the license page say it. */
    credit: string;
    /** Mel bands the model listens with (Parakeet only). */
    mels?: number;
    /** Whether the encoder can run on the graphics card when there is one (Parakeet only). */
    card?: boolean;
}

/** Where the files are fetched from. */
export const HOST = "https://huggingface.co";

/** The tiers, the most accurate first. */
export const TIERS: Tier[] = [
    {
        id: "main",
        name: "Accurate",
        note: "The most accurate, and quick on a graphics card. Parakeet Ultra.",
        engine: "parakeet",
        mels: 128,
        card: true,
        repo: "Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx",
        files: [
            { role: "encoder", path: "w4a8/encoder-model.w4a8.onnx", bytes: 383355483 },
            { role: "decoder", path: "int8/decoder_joint-model.int8.onnx", bytes: 18203490 },
            { role: "vocab", path: "vocab.txt", bytes: 93939 },
        ],
        license: "CC BY 4.0",
        credit: "Parakeet Ultra by moondream, trained from NVIDIA Parakeet TDT 0.6b v3; ONNX files by Olicorne",
    },
    {
        id: "light",
        name: "Light",
        note: "Half the size, nearly as accurate. Parakeet Redux.",
        engine: "parakeet",
        mels: 128,
        repo: "Olicorne/parakeet-tdt-0.6b-v3-redux-onnx",
        files: [
            { role: "encoder", path: "w2a8/encoder-model.w2a8.onnx", bytes: 189893007 },
            { role: "decoder", path: "int8/decoder_joint-model.int8.onnx", bytes: 18203490 },
            { role: "vocab", path: "vocab.txt", bytes: 93939 },
        ],
        license: "CC BY 4.0",
        credit: "Parakeet Redux by moondream, trained from NVIDIA Parakeet TDT 0.6b v3; ONNX files by Olicorne",
    },
    {
        id: "tiny",
        name: "Tiny",
        note: "For phones and slow connections. Moonshine tiny, English only.",
        engine: "moonshine",
        repo: "onnx-community/moonshine-tiny-ONNX",
        files: [
            { role: "encoder", path: "onnx/encoder_model.onnx", bytes: 30882331 },
            { role: "decoder", path: "onnx/decoder_model_merged_int8.onnx", bytes: 20189512 },
            { role: "tokenizer", path: "tokenizer.json", bytes: 3761754 },
        ],
        license: "MIT",
        credit: "Moonshine tiny by Useful Sensors; ONNX files by onnx-community",
    },
];

/** The tier with this id. */
export const tierOf = (id: string): Tier => TIERS.find((tier) => tier.id === id) ?? TIERS.find((tier) => tier.id === "light")!;

/** Where one file is fetched from. */
export const addressOf = (tier: Tier, file: ModelFile): string => `${HOST}/${tier.repo}/resolve/main/${file.path.split("/").map(encodeURIComponent).join("/")}`;

/** The whole download of a tier, in bytes. */
export const sizeOf = (tier: Tier): number => tier.files.reduce((sum, file) => sum + file.bytes, 0);

/** A size in bytes as the panel says it: "55 MB", "668 MB", "1.2 GB". */
export function megabytes(bytes: number): string {
    const mb = bytes / 1e6;
    return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** What is known of the device when the default is chosen. */
export interface Device {
    /** A phone or a tablet. */
    mobile: boolean;
    /** The connection is slow or the visitor asked to save data. */
    slow: boolean;
    /** The browser can use the graphics card. */
    gpu: boolean;
    /** Gigabytes of memory the browser reports, if it does. */
    memory?: number;
}

/** The tier to start on: tiny for a phone, a slow connection or little memory; light otherwise. The visitor can always change it. */
export function defaultTier(device: Device): Tier["id"] {
    if (device.mobile || device.slow || (device.memory !== undefined && device.memory < 4)) return "tiny";
    return "light";
}

/** Where a tier runs on this machine, in the words the panel uses. */
export const placeOf = (tier: Tier, device: Pick<Device, "gpu">): "graphics card" | "processor" => (tier.card && device.gpu ? "graphics card" : "processor");

/** Reads the device from the browser. */
export function deviceNow(): Device {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const connection = nav.connection;
    return {
        mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent),
        slow: !!connection?.saveData || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? ""),
        gpu: "gpu" in navigator,
        memory: nav.deviceMemory,
    };
}
