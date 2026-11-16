// What the codec strings are held to: each is made from its configuration box as the codec registry
// says, and the boxes made back from a codec string give the same string.

import { expect, test } from "bun:test";
import { boxes, dOpsFrom, opusHeadFrom } from "./mp4";
import { opusHead } from "./ogg";
import { aacCodec, av1CFrom, av1Codec, avcCodec, vp9Codec, vpcCFrom } from "./tracks";

const avcC = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const asc = new Uint8Array([0x11, 0x90]);

test("codec strings come from their configuration boxes and go back into them", () => {
    expect(avcCodec(avcC)).toBe("avc1.640028");
    expect(vp9Codec(vpcCFrom("vp09.00.40.08"))).toBe("vp09.00.40.08");
    expect(av1Codec(av1CFrom("av01.0.08M.08"))).toBe("av01.0.08M.08");
    expect(av1Codec(av1CFrom("av01.0.12H.10"))).toBe("av01.0.12H.10");
    expect(aacCodec(asc)).toBe("mp4a.40.2");
    expect(aacCodec(new Uint8Array([0x2b, 0x92, 0x08, 0x00]))).toBe("mp4a.40.5");
    const head = opusHead(2, 312, 44100);
    expect(opusHeadFrom(boxes(dOpsFrom(head))[0]!.body)).toEqual(head);
});
