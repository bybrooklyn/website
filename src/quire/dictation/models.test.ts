// The model table: every tier has what an engine needs, sizes add up, addresses are right, and the
// default tier follows the device.

import { describe, expect, test } from "bun:test";
import { addressOf, defaultTier, deviceNow, megabytes, placeOf, sizeOf, tierOf, TIERS } from "./models";

describe("the tiers", () => {
    test("each has an encoder and a decoder, and the vocabulary its engine reads", () => {
        for (const tier of TIERS) {
            const roles = tier.files.map((file) => file.role);
            expect(roles).toContain("encoder");
            expect(roles).toContain("decoder");
            expect(roles).toContain(tier.engine === "parakeet" ? "vocab" : "tokenizer");
        }
    });
    test("each names a license and who made it", () => {
        for (const tier of TIERS) {
            expect(tier.license.length).toBeGreaterThan(0);
            expect(tier.credit.length).toBeGreaterThan(0);
        }
    });
    test("the Accurate tier uses the 4-bit encoder, the only kind the graphics card can run, and the Light one the 2-bit encoder", () => {
        expect(tierOf("main").files.find((file) => file.role === "encoder")!.path).toContain("w4a8");
        expect(tierOf("main").card).toBe(true);
        expect(tierOf("light").files.find((file) => file.role === "encoder")!.path).toContain("w2a8");
        expect(tierOf("light").card).toBeFalsy();
    });
    test("get smaller from main to tiny", () => {
        expect(sizeOf(tierOf("main"))).toBeGreaterThan(sizeOf(tierOf("light")));
        expect(sizeOf(tierOf("light"))).toBeGreaterThan(sizeOf(tierOf("tiny")));
    });
    test("an unknown id gives the light tier", () => {
        expect(tierOf("nope").id).toBe("light");
    });
});

test("addressOf is the repository's resolve address for the file", () => {
    const tiny = tierOf("tiny");
    expect(addressOf(tiny, tiny.files[0]!)).toBe("https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/onnx/encoder_model.onnx");
});

test("addressOf fetches at the tier's revision, which every tier names", () => {
    for (const tier of TIERS) expect(tier.revision.length).toBeGreaterThan(0);
    const tiny = { ...tierOf("tiny"), revision: "0123abcd" };
    expect(addressOf(tiny, tiny.files[0]!)).toBe("https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/0123abcd/onnx/encoder_model.onnx");
});

test("megabytes says a size the way the panel does", () => {
    expect(megabytes(54833597)).toBe("55 MB");
    expect(megabytes(667728000)).toBe("668 MB");
    expect(megabytes(1218200000)).toBe("1.2 GB");
});

describe("the default tier", () => {
    const strong = { mobile: false, slow: false, gpu: true, memory: 8 };
    test("is the light one on a desktop or laptop, with or without a graphics card", () => {
        expect(defaultTier(strong)).toBe("light");
        expect(defaultTier({ ...strong, memory: undefined })).toBe("light");
        expect(defaultTier({ ...strong, gpu: false })).toBe("light");
    });
    test("is the tiny one on a phone, a slow connection or little memory", () => {
        expect(defaultTier({ ...strong, mobile: true })).toBe("tiny");
        expect(defaultTier({ ...strong, slow: true })).toBe("tiny");
        expect(defaultTier({ ...strong, memory: 2 })).toBe("tiny");
    });
    test("says graphics card only where the tier can use one and there is one", () => {
        expect(placeOf(tierOf("main"), { gpu: true })).toBe("graphics card");
        expect(placeOf(tierOf("main"), { gpu: false })).toBe("processor");
        expect(placeOf(tierOf("light"), { gpu: true })).toBe("processor");
        expect(placeOf(tierOf("tiny"), { gpu: true })).toBe("processor");
    });
    test("an iPad, which says it is a Mac, is read as a tablet by its touch screen, and a Mac without one is not", () => {
        const saved = globalThis.navigator;
        const as = (userAgent: string, maxTouchPoints: number) => {
            Object.defineProperty(globalThis, "navigator", { value: { userAgent, maxTouchPoints }, configurable: true });
            return deviceNow();
        };
        const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
        try {
            expect(as(mac, 5).mobile).toBe(true);
            expect(defaultTier(as(mac, 5))).toBe("tiny");
            expect(as(mac, 0).mobile).toBe(false);
        } finally {
            Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
        }
    });
});
