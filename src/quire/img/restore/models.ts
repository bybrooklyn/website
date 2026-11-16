// The models that repair a JPEG and enlarge a picture, in one small table, fetched as the text models are
// (read/store.ts): from Hugging Face, at a pinned commit of each repository, the file checked against the
// SHA-256 written here (worked out from the trial copies, whose sizes are the listings'). Each model is one
// file. What was measured to choose them, and what is and is not known of each license, is in
// docs/imgQuire-models.md.

import type { Pinned } from "../read/models";
import { MOST_SIDE } from "../tiles";

/** One restoring model: its file, what it does, how it takes a picture, and where it runs right. */
export interface RestoreModel extends Pinned {
    id: string;
    /** Its name on its card. */
    name: string;
    /** Who it suits and what it costs in time, in a few plain words, for its card. */
    who: string;
    job: "repair" | "enlarge";
    /** How many times larger its answer is than what it is given. */
    scale: 1 | 2 | 4;
    /** The numbers it takes and gives: 32-bit, or 16-bit (`float16`, given as their bits). */
    input: "float32" | "float16";
    output: "float32" | "float16";
    /** A size it takes and no other, square; else any size, in whole steps of `multiple` when it says one. */
    fixed?: number;
    multiple?: number;
    /** The tile's middle and the margin read round it (tiles.ts), in the picture's pixels. */
    tile: number;
    margin: number;
    /** How hard ONNX Runtime may rewrite its graph: some files only load with less. */
    level: "all" | "extended" | "basic" | "disabled";
    /** The fp16 Swin2SR files name their output's size as their input's (graph.ts mends it). */
    untie?: boolean;
    /** The highest JPEG quality it was measured to improve; above it, it is not offered. */
    mostQuality?: number;
    /** FBCNN is told the file's quality. */
    quality?: boolean;
    /** Where it was tried and gives right answers in good time: the graphics card, WebAssembly, or both. */
    places: ("webgpu" | "wasm")[];
    /** Who made it and where it is from, as the dialog says it. */
    credit: string;
    license: string;
}

const model = (fields: Omit<RestoreModel, "output"> & { output?: RestoreModel["output"] }): RestoreModel => ({ output: fields.input, ...fields });

// each repository at the commit its file was fetched at for the trial on 15 November 2026; the digests were worked out from those copies
const DEJPEG = ["colpona/dejpeg-models", "3cc3250ce83e61bffdc1c6ffcfb27161951f5e9f"] as const;

/**
 * JPEG repair, the smaller first: SCUNet (real PSNR, fp16) and FBCNN (colour, fp16), both from a third party's
 * conversions of their makers' weights. Both run right on the graphics card only in good time: on WebAssembly a
 * megapixel takes a minute and a half (SCUNet) or a minute (FBCNN), so neither is offered there. SCUNet's file only
 * loads with ONNX Runtime's basic rewriting.
 */
export const REPAIR_MODELS: RestoreModel[] = [
    model({
        id: "repair-better",
        name: "Better",
        who: "Blocks and noise smoothed away",
        job: "repair",
        repo: DEJPEG[0],
        revision: DEJPEG[1],
        path: "scunet/scunet_color_real_psnr_fp16.onnx",
        bytes: 37746503,
        sha256: "8923b09e240e0078b3247964e9b105cbfbb4da01e260b29a961d038f8fa7791a",
        scale: 1,
        input: "float16",
        tile: 512,
        margin: 32,
        level: "basic",
        // above 50 some pictures came out further from the clean picture than the instant repair leaves them, and at 90 most did
        mostQuality: 50,
        places: ["webgpu"],
        credit: "SCUNet by Kai Zhang and others, converted by colpona",
        license: "Apache-2.0 upstream",
    }),
    model({
        id: "repair-best",
        name: "Best",
        who: "Blocks gone, detail kept",
        job: "repair",
        repo: DEJPEG[0],
        revision: DEJPEG[1],
        path: "fbcnn/fbcnn_color_fp16.onnx",
        bytes: 143910675,
        sha256: "1a678ff4f721b557fd8a7e560b99cb94ba92f201545c7181c703e7808b93e922",
        scale: 1,
        input: "float32",
        tile: 512,
        margin: 32,
        level: "all",
        quality: true,
        places: ["webgpu"],
        credit: "FBCNN by Jiaxi Jiang and others, converted by colpona",
        license: "Apache-2.0 upstream",
    }),
];

/**
 * Enlarging: Swin2SR's lightweight model, twice as large, run twice for four times. Its fp16 export names its
 * output's size as its input's (graph.ts mends it), and loads on WebAssembly only with ONNX Runtime's extended
 * rewriting. On the graphics card it runs but gives a picture laced with a fine wrong pattern, with no error
 * said (as Swin2SR's other files do there), so it runs on WebAssembly everywhere.
 */
export const ENLARGE_MODELS: RestoreModel[] = [
    model({
        id: "enlarge-small",
        name: "Sharp",
        who: "Faithful edges, a minute or two a megapixel",
        job: "enlarge",
        repo: "Xenova/swin2SR-lightweight-x2-64",
        revision: "92a21aca5713f20faf9a87590cdfbdce2e34112c",
        path: "onnx/model_fp16.onnx",
        bytes: 7524409,
        sha256: "96a120768ff28d61591be145e5bc9d71be62cd3df7dcc386fdbd36f15f2235dd",
        scale: 2,
        input: "float32",
        multiple: 8,
        tile: 128,
        margin: 16,
        level: "extended",
        untie: true,
        places: ["wasm"],
        credit: "Swin2SR by Marcos V. Conde and others, converted by Xenova",
        license: "Apache-2.0",
    }),
];

/** Every model offered. */
export const RESTORE_MODELS = (): RestoreModel[] => [...REPAIR_MODELS, ...ENLARGE_MODELS];

/** The model with this id, if one is offered. */
export const restoreModelOf = (id: string | null | undefined): RestoreModel | undefined => RESTORE_MODELS().find((each) => each.id === id);

/** The most pixels a model's enlargement may have: four bytes each, a quarter of a gigabyte held on the page. */
export const MOST_ENLARGED = 64_000_000;

/** The size a model's enlargement of a picture of this size would be, or undefined when past a picture's largest side or the most pixels. */
export function enlargedSize(size: { width: number; height: number }, model: { scale: number }): { width: number; height: number } | undefined {
    const width = size.width * model.scale;
    const height = size.height * model.scale;
    return width <= MOST_SIDE && height <= MOST_SIDE && width * height <= MOST_ENLARGED ? { width, height } : undefined;
}

void model;
