// The models that find parts of a picture for grading, in one small table, fetched as the text
// models are (read/store.ts): from Hugging Face, at a pinned commit of each repository, each file
// checked against the SHA-256 written here. Two choices: small, SlimSAM 77 (int8) to press a thing
// and MODNet (fp16) for the subject; better, SAM 2.1 tiny (q4) and ormbg (int8). All Apache-2.0
// (SAM 2.1's copy says none on its card; its upstream, facebookresearch/sam2, is Apache-2.0). What
// was measured to choose them is in docs/imgQuire-models.md.

import type { Pinned } from "../read/models";

/** What a file is for: the image encoder of a press-to-select model and its external weights, its prompt decoder and weights, or the subject model. */
export type PartRole = "encode" | "encodeData" | "decode" | "decodeData" | "matte";

/** One file of a part model. */
export interface PartFile extends Pinned {
    role: PartRole;
}

/** A choice of part models. */
export interface PartTier {
    id: string;
    name: string;
    who: string;
    /** How the press-to-select model takes a picture: SAM 2.1 squeezed to 1024 square; SlimSAM its longer side 1024 and padded. */
    select: "sam2" | "slim";
    /** How the subject model takes a picture: ormbg at 1024 square from 0 to 1; MODNet its shorter side 512, from -1 to 1; BiRefNet 1024 square, ImageNet's numbers, logits out. */
    matte: "ormbg" | "modnet" | "birefnet";
    files: PartFile[];
    credit: string;
    /** How long a picture usually takes on the machine it is offered on, in plain words, for a slow choice to say while it works. */
    wait?: string;
    /** The models that run right on the graphics card (each was tried there on the site's ONNX Runtime); the rest run on WebAssembly. */
    card: ("encode" | "decode" | "matte")[];
}

const file = (role: PartRole, repo: string, revision: string, path: string, bytes: number, sha256: string): PartFile => ({ role, repo, revision, path, bytes, sha256 });
const SLIM = ["Xenova/slimsam-77-uniform", "5850ab45f587c112167512ffef949107115e26a0"] as const;
const MODNET = ["Xenova/modnet", "fa2fa546052fba4c08921230a26cc69a333fca12"] as const;
const SAM2 = ["onnx-community/sam2.1-hiera-tiny-ONNX", "814a066640debee5a91e70aa401fb8e17e030503"] as const;
const ORMBG = ["onnx-community/ormbg-ONNX", "034e2d884afbab897e10e78fc5bb566b29533fd6"] as const;

/**
 * Which models run right on the graphics card, as tried on the site's ONNX Runtime 1.24.1
 * (docs/imgQuire-models.md): both image encoders do; SlimSAM's decoder does but is slower there than on
 * WebAssembly; SAM 2.1's decoder runs there but gives a wrong mask; MODNet's fp16 file has a fused
 * convolution the card's runtime lacks, and ormbg a pooling it cannot size, so both stay on WebAssembly.
 */
const CARD_SMALL: PartTier["card"] = ["encode"];
const CARD_BETTER: PartTier["card"] = ["encode"];

// each repository at the commit its listing was read at on 14 November 2026; every digest is the listing's own (`lfs.oid`), and the trial copies were checked against them
/** The two choices, the smaller first, which is the one to start on. */
export const PART_TIERS: PartTier[] = [
    {
        id: "small",
        name: "Small",
        who: "Quick, on any machine",
        select: "slim",
        matte: "modnet",
        credit: "SlimSAM 77 and MODNet",
        card: CARD_SMALL,
        files: [
            file("encode", ...SLIM, "onnx/vision_encoder_quantized.onnx", 8882165, "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971"),
            file("decode", ...SLIM, "onnx/prompt_encoder_mask_decoder_quantized.onnx", 4903810, "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2"),
            file("matte", ...MODNET, "onnx/model_fp16.onnx", 12984781, "25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6"),
        ],
    },
    {
        id: "better",
        name: "Better",
        who: "Cleaner edges, on a fast machine",
        select: "sam2",
        matte: "ormbg",
        credit: "SAM 2.1 tiny and ormbg",
        card: CARD_BETTER,
        files: [
            file("encode", ...SAM2, "onnx/vision_encoder_q4.onnx", 366089, "c3efeef6c8e5e0cd718d9fea53b760fd09e109dc8f670c7ca592181a1eca6526"),
            file("encodeData", ...SAM2, "onnx/vision_encoder_q4.onnx_data", 43758848, "ca3afaa983c6fe53449df092b4cf4e8d2442e44ebacf02dc5303ca5299342a9f"),
            file("decode", ...SAM2, "onnx/prompt_encoder_mask_decoder_q4.onnx", 226444, "9d07a46ca6035cd22ec29391ed13e19a7c9f5fc3dd5bd6df92c8e2e0a23ba9c1"),
            file("decodeData", ...SAM2, "onnx/prompt_encoder_mask_decoder_q4.onnx_data", 7130112, "5e912af5533c6ab05330886ba42712f3f9d7ac60e3f1cc39d936a85d958f2d94"),
            file("matte", ...ORMBG, "onnx/model_int8.onnx", 44315136, "905f6c0d4e10d64e9ee54216ab2ae0f6ee01f5ee017dadedaba120c4eb854714"),
        ],
    },
];

const BIREFNET = ["onnx-community/BiRefNet_lite-ONNX", "de15b22ba131738a16dff04aab8bdf8dc32e3ac1"] as const;
const BIREFNET_WEBGPU = ["wonfy/BiRefNet_lite-ONNX-webgpu", "c40eaa22fb1af9edcf75c7b79d25ed8a8e901140"] as const;

/** BiRefNet lite in fp16, the stock export and a third party's rebuild of its graph for WebGPU (the same weights; its card says MIT, from ZhengPeng7/BiRefNet_lite), both read on 14 November 2026. */
export const BIREFNET_FILES = {
    stock: file("matte", ...BIREFNET, "onnx/model_fp16.onnx", 114538221, "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402"),
    webgpu: file("matte", ...BIREFNET_WEBGPU, "onnx/model_fp16.onnx", 123210389, "2290313b335cfdb867eefac47b46aa2b225793fc3deb4da8dbc86e71e9cff2d7"),
};

const cut = (id: string, name: string, who: string, matte: PartTier["matte"], credit: string, matteFile: PartFile, card: PartTier["card"], wait?: string): PartTier => ({ id, name, who, select: "slim", matte, credit, card, files: [matteFile], ...(wait ? { wait } : {}) });

/**
 * The cut-out's three qualities, the smallest first: Quick, MODNet (made for people); Better, ormbg;
 * Best, BiRefNet lite's rebuild for WebGPU. MODNet and ormbg run on WebAssembly only (see above). Best
 * runs only on a graphics card: on WebAssembly it runs out of memory, and the stock export does on the
 * card too (docs/imgQuire-models.md), so it is offered only where there is a card.
 */
export const CUT_TIERS: PartTier[] = [
    cut("cut-quick", "Quick", "Under a second a picture, people only", "modnet", "MODNet", PART_TIERS[0]!.files.find((each) => each.role === "matte")!, []),
    cut("cut-better", "Better", "About 20 seconds a picture, most things", "ormbg", "ormbg", PART_TIERS[1]!.files.find((each) => each.role === "matte")!, [], "about 20 seconds"),
    cut("cut-best", "Best", "About a second a picture, hair and fine edges", "birefnet", "BiRefNet lite", BIREFNET_FILES.webgpu, ["matte"]),
];

/** The choice with this id (a part choice or a cut-out's), or the smaller part choice. */
export const partTierOf = (id: string | null | undefined): PartTier => [...PART_TIERS, ...CUT_TIERS].find((tier) => tier.id === id) ?? PART_TIERS[0]!;

/** A choice's file for a role, if it has one. */
export const partFile = (tier: PartTier, role: PartRole): PartFile | undefined => tier.files.find((each) => each.role === role);

/** The whole download of a choice, in bytes. */
export const partSize = (tier: PartTier): number => tier.files.reduce((sum, each) => sum + each.bytes, 0);
