// The recognizer's dictionary: the characters its outputs stand for, read out of the `inference.yml`
// beside the model, where PaddlePaddle keeps them as a YAML list under `character_dict`. Only that
// list is read, by hand: each line `  - x` is one character, plain, or in single quotes (where two
// quotes stand for one), or in double quotes with backslash escapes. The model's outputs are the
// blank of CTC first, then the characters in order, then a space, which the file does not list.

/** The characters a recognizer's outputs stand for, in order: the blank (an empty string) first and the space last. */
export function readDictionary(yml: string): string[] {
    const lines = yml.split(/\r?\n/);
    const start = lines.findIndex((line) => /^\s*character_dict:\s*$/.test(line));
    if (start < 0) throw new Error("the recognizer's file has no list of characters");
    const indent = /^(\s*)/.exec(lines[start + 1] ?? "")?.[1] ?? "";
    const characters: string[] = [];
    for (let at = start + 1; at < lines.length; at++) {
        const line = lines[at]!;
        if (!line.startsWith(`${indent}- `)) break;
        characters.push(scalar(line.slice(indent.length + 2)));
    }
    if (!characters.length) throw new Error("the recognizer's list of characters is empty");
    return ["", ...characters, " "];
}

/** One YAML scalar of a list item, unquoted. */
export function scalar(text: string): string {
    if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replaceAll("''", "'");
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
        return text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2}|.)/g, (_, code: string) => {
            if (/^[uUx]/.test(code) && code.length > 1) return String.fromCodePoint(parseInt(code.slice(1), 16));
            return ({ n: "\n", t: "\t", r: "\r", "0": "\0", " ": " ", "/": "/", "\\": "\\", '"': '"' } as Record<string, string>)[code] ?? code;
        });
    }
    return text.trim();
}
