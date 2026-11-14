// The models that read text in a picture, in one small table, fetched the way dictation fetches its
// speech models: from Hugging Face, at a pinned commit of each repository, each file checked against
// the SHA-256 written here before it is used. All are PaddlePaddle's own PP-OCRv6 files, Apache-2.0.
//
// Three sizes, each a detector that finds the lines and a recognizer that reads them, with its
// dictionary (the recognizer's `inference.yml`); the two larger ones add a small model that turns an
// upside-down line the right way up, and the largest one more that finds a page turned on its side.
// What was measured to choose them is in docs/imgQuire-models.md.

/** What a file is for. */
export type Role = "detect" | "recognize" | "dictionary" | "line" | "page";

/** One file: the repository and commit it comes from, its path there, its size in bytes and the SHA-256 of its bytes in hex. */
export interface ModelFile {
    role: Role;
    repo: string;
    revision: string;
    path: string;
    bytes: number;
    sha256: string;
}

/** A size of model. */
export interface Tier {
    id: "tiny" | "small" | "large";
    /** Its name on its card. */
    name: string;
    /** Who it suits, in a few words, for its card. */
    who: string;
    files: ModelFile[];
    /** How sure the detector must be, on average over a line, for the line to be read (PaddleOCR's `box_thresh` for these files). */
    sure: number;
    /** Who made it, as the dialog says it. */
    credit: string;
}

/** Where the files are fetched from. */
export const HOST = "https://huggingface.co";

/** The license every file here is under. */
export const LICENSE = "Apache-2.0";

const PADDLE = "PaddlePaddle/";
// Each repository at the commit its listing was read at on 14 November 2026; the large files' digests
// are the listing's own (`lfs.oid`), the dictionaries' were computed from the files fetched at that commit.
const file = (role: Role, repo: string, revision: string, path: string, bytes: number, sha256: string): ModelFile => ({ role, repo: PADDLE + repo, revision, path, bytes, sha256 });
const LINE = file("line", "PP-LCNet_x1_0_textline_ori_onnx", "7fdcf3cf7061163eda7183b224aa334bd33068f7", "inference.onnx", 6777816, "38aa97cd4be591e0ad304e659f07ba30d946f27a63315433f6659c69c8778345");
const PAGE = file("page", "PP-LCNet_x1_0_doc_ori_onnx", "7330ab7039123e46af2dc03154b9969aa412c61d", "inference.onnx", 6788069, "af9a0a4f317ff0709ce752067807f819cb15d883f8ecad89f28df1c6ee2d9c92");

/** The sizes, the smallest first, which is the one to start on: it reads a clear screenshot well. */
export const TIERS: Tier[] = [
    {
        id: "tiny",
        name: "Tiny",
        who: "Clear screenshots, on any machine",
        sure: 0.4,
        credit: "PP-OCRv6 tiny by PaddlePaddle",
        files: [
            file("detect", "PP-OCRv6_tiny_det_onnx", "2ba1506c0380b8f0b03dd142459aac66d4421f6c", "inference.onnx", 1780590, "193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8"),
            file("recognize", "PP-OCRv6_tiny_rec_onnx", "2612ab37152ae0a677521bae4e1e3d4fb4cf7c30", "inference.onnx", 4462639, "9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6"),
            file("dictionary", "PP-OCRv6_tiny_rec_onnx", "2612ab37152ae0a677521bae4e1e3d4fb4cf7c30", "inference.yml", 55571, "66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1"),
        ],
    },
    {
        id: "small",
        name: "Small",
        who: "Photographs and turned lines",
        sure: 0.45,
        credit: "PP-OCRv6 small and PP-LCNet by PaddlePaddle",
        files: [
            file("detect", "PP-OCRv6_small_det_onnx", "28fe5895c24fd108c19eb3e8479f4ab385fbfc62", "inference.onnx", 9880512, "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e"),
            file("recognize", "PP-OCRv6_small_rec_onnx", "b8f84f0b80c529de40b4fbb3544b84fa7233a513", "inference.onnx", 21159378, "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634"),
            file("dictionary", "PP-OCRv6_small_rec_onnx", "b8f84f0b80c529de40b4fbb3544b84fa7233a513", "inference.yml", 150579, "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1"),
            LINE,
        ],
    },
    {
        id: "large",
        name: "Large",
        who: "Hard pictures, on a fast machine",
        sure: 0.45,
        credit: "PP-OCRv6 medium and PP-LCNet by PaddlePaddle",
        files: [
            file("detect", "PP-OCRv6_medium_det_onnx", "61323801669c338b7891481ec7bac61ce31b576a", "inference.onnx", 62032837, "eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1"),
            file("recognize", "PP-OCRv6_medium_rec_onnx", "50c7eacafc52fa7bcf4194e8cd08e46f8558504b", "inference.onnx", 76554979, "9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba"),
            file("dictionary", "PP-OCRv6_medium_rec_onnx", "50c7eacafc52fa7bcf4194e8cd08e46f8558504b", "inference.yml", 150580, "991b700facf5b50a7de193468207d5f4255b538dde0d312ae3b7c7a9b6873129"),
            LINE,
            PAGE,
        ],
    },
];

/** The tier with this id, or the smallest. */
export const tierOf = (id: string | null | undefined): Tier => TIERS.find((tier) => tier.id === id) ?? TIERS[0]!;

/** Where one file is fetched from: the host, its repository, the pinned commit and its path. */
export const addressOf = (each: ModelFile, host = HOST): string => `${host}/${each.repo}/resolve/${each.revision}/${each.path.split("/").map(encodeURIComponent).join("/")}`;

/** The name a file is kept under in the browser: its repository, commit and path, so that two sizes sharing a file keep it once, and a file of another commit is never taken for it. */
export const keptName = (each: ModelFile): string => `${each.repo.replace(/\W+/g, "-")}-${each.revision.slice(0, 12)}-${each.path.replace(/\W+/g, "-")}`;

/** The whole download of a tier, in bytes. */
export const sizeOf = (tier: Tier): number => tier.files.reduce((sum, each) => sum + each.bytes, 0);

/** A size in bytes as a card says it: "6 MB", "38 MB", "152 MB". */
export const megabytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** The tier's file for a role, if it has one. */
export const fileFor = (tier: Tier, role: Role): ModelFile | undefined => tier.files.find((each) => each.role === role);
