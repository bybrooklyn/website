// The one kind of error the text and data converters give: a plain sentence for a person, the line it
// was found on where there is one, and what can be done instead where something can.
//
//   throw new DataError("A quote opened on line 3 is never closed.", { line: 3 });
//   throw new DataError("...", { offer: { key: "flatten", words: "Flatten nested values into columns." } });

/** What can be done when a shape cannot be carried: a short sentence for a person, a key the page acts on, and for "wrap" the name to put things under. */
export interface Offer {
    key: "flatten" | "wrap" | "drop-nulls" | "first-table" | "no-header";
    words: string;
    name?: string;
}

/** A text that cannot be read, or a shape that cannot be written, said in plain words. */
export class DataError extends Error {
    line?: number;
    offer?: Offer;
    constructor(message: string, more: { line?: number; offer?: Offer } = {}) {
        super(message);
        this.name = "DataError";
        if (more.line !== undefined) this.line = more.line;
        if (more.offer) this.offer = more.offer;
    }
}
