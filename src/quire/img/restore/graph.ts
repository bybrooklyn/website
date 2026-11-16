// One mend to a model file's bytes, made after its digest is checked and before ONNX Runtime reads it. Two of
// the Swin2SR files (their fp16 exports) name their output's height and width with the same names as their
// input's, though the output is two or four times as large; ONNX Runtime takes the names at their word and
// sets aside an output of the input's size, and the run fails. Renaming the output's names (the last letter
// made `_`, so every length in the file stays as it was) unties the two. Nothing else in the file is touched.
//
// The file is read as protobuf by hand: a model's graph is its field 7, the graph's outputs its field 12, and
// an output's size names lie in type (2), tensor type (1), shape (2), dimension (1), name (2).

/** Calls `each` with the number, start and end of every field of a run of protobuf that carries bytes (wire type 2), from `from` to `to`. */
function walk(bytes: Uint8Array, from: number, to: number, each: (field: number, start: number, end: number) => void): void {
    const varint = (at: number): [number, number] => {
        let value = 0;
        let scale = 1;
        for (let read = 0; read < 10; read++) {
            if (at >= to) throw new Error("the model file ends inside a number");
            const byte = bytes[at++]!;
            value += (byte & 0x7f) * scale;
            if (!(byte & 0x80)) return [value, at];
            scale *= 128;
        }
        throw new Error("the model file has a number too long to be one");
    };
    let at = from;
    while (at < to) {
        const [key, next] = varint(at);
        at = next;
        const wire = key % 8;
        if (wire === 0) at = varint(at)[1];
        else if (wire === 1) at += 8;
        else if (wire === 5) at += 4;
        else if (wire === 2) {
            const [length, start] = varint(at);
            if (start + length > to) throw new Error("the model file has a field longer than what holds it");
            each(Math.floor(key / 8), start, start + length);
            at = start + length;
        } else throw new Error("the model file is not one ONNX Runtime reads");
    }
}

/** The value named in the graph's notes (its field 13) that the fp16 converter put before the output, whose sizes are noted with the input's names too. */
const BEFORE_OUTPUT = "graph_output_cast";

/** Renames, in place, the names the first output of a model gives its sizes, and those of the half-precision value it is cast from, so that they are no longer the input's. Gives how many names were changed. */
export function untieOutput(bytes: Uint8Array): number {
    let changed = 0;
    const inside = (start: number, end: number, field: number, then: (start: number, end: number) => void) => walk(bytes, start, end, (number, from, to) => number === field && then(from, to));
    const nameOf = (start: number, end: number) => {
        let name = "";
        inside(start, end, 1, (from, to) => (name = new TextDecoder().decode(bytes.subarray(from, to))));
        return name;
    };
    walk(bytes, 0, bytes.length, (field, start, end) => {
        if (field !== 7) return;
        let first = true;
        walk(bytes, start, end, (number, start, end) => {
            if (number === 12) {
                if (!first) return;
                first = false;
            } else if (number !== 13 || !nameOf(start, end).startsWith(BEFORE_OUTPUT)) return;
            inside(start, end, 2, (start, end) =>
                inside(start, end, 1, (start, end) =>
                    inside(start, end, 2, (start, end) =>
                        inside(start, end, 1, (start, end) =>
                            inside(start, end, 2, (from, to) => {
                                if (to > from) {
                                    bytes[to - 1] = 0x5f;
                                    changed++;
                                }
                            }),
                        ),
                    ),
                ),
            );
        });
    });
    return changed;
}
