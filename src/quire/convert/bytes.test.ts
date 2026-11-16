// What the bytes helper is held to: numbers come out in the order and width asked, the buffer grows
// past its first size without losing what was written, a size can be put back afterwards, and a blob is
// read a range at a time with a range past its end cut short.

import { expect, test } from "bun:test";
import { Bytes, joined, sourceOf, textOf, viewOf } from "./bytes";

test("numbers come out big-endian or little-endian in their widths, and the buffer grows", () => {
    const out = new Bytes();
    out.u8(1).u16(0x0203).u24(0x040506).u32(0x0708090a).u16(0x0b0c, true).u32(0x0d0e0f10, true).i16(-2).text("ab");
    expect([...out.done()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0x0c, 0x0b, 0x10, 0x0f, 0x0e, 0x0d, 0xff, 0xfe, 97, 98]);
    const big = new Bytes();
    for (let index = 0; index < 1000; index++) big.u32(index);
    big.u64(2 ** 40 + 5).f64(1.5);
    const view = viewOf(big.done());
    expect(view.getUint32(999 * 4)).toBe(999);
    expect(Number(view.getBigUint64(4000))).toBe(2 ** 40 + 5);
    expect(view.getFloat64(4008)).toBe(1.5);
    big.put32(0, 77);
    expect(viewOf(big.done()).getUint32(0)).toBe(77);
});

test("a blob is read a range at a time, a range past its end cut short", async () => {
    const source = sourceOf(new Blob([new Uint8Array([10, 20, 30, 40, 50])]));
    expect(source.size).toBe(5);
    expect([...(await source.read(1, 2))]).toEqual([20, 30]);
    expect([...(await source.read(3, 10))]).toEqual([40, 50]);
    expect((await source.read(9, 2)).length).toBe(0);
    expect(textOf(new Uint8Array([79, 103, 103, 83]))).toBe("OggS");
    expect([...joined([new Uint8Array([1]), new Uint8Array([2, 3])])]).toEqual([1, 2, 3]);
});
