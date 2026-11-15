// What the part models' table is held to: every file is pinned to a full commit and a SHA-256 and
// fetched from that commit; each choice has an encoder, a decoder and a subject model, with the
// weights SAM 2.1 keeps beside its files; the sizes are those the owner was told; and the card runs
// only the image encoders, as tried.

import { expect, test } from "bun:test";
import { addressOf } from "../read/models";
import { partFile, partSize, partTierOf, PART_TIERS } from "./models";

test("every file is pinned to a commit and a digest, fetched from that commit, and each choice has what finding needs", () => {
    for (const tier of PART_TIERS) {
        for (const each of tier.files) {
            expect(each.revision).toMatch(/^[0-9a-f]{40}$/);
            expect(each.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(addressOf(each)).toBe(`https://huggingface.co/${each.repo}/resolve/${each.revision}/${each.path}`);
        }
        for (const role of ["encode", "decode", "matte"] as const) expect(partFile(tier, role)).toBeDefined();
        expect(tier.card).toEqual(["encode"]);
    }
    expect(partFile(partTierOf("better"), "encodeData")!.path).toBe("onnx/vision_encoder_q4.onnx_data");
    expect(Math.round(partSize(partTierOf("small")) / 1e6)).toBe(27);
    expect(Math.round(partSize(partTierOf("better")) / 1e6)).toBe(96);
    expect(partTierOf("nonsense").id).toBe("small");
});
