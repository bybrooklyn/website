// imgQuire as a kind of document for the core's app (core/kind.ts): its documents are `.quire` files
// that keep their steps in steps.json with the original beside them, which the stores say without
// opening them; a picture chosen, pasted or dropped becomes one; its row on the shelf says "picture";
// and its editor is editor.ts in the core's frame.
//
//   startApp(host, { kinds: [markdown({ colors, sample }), img()], top });

import type { Kind } from "../core/kind";
import { MAIN, mountEditor } from "./editor";

/** The kinds of picture a browser decodes, as a file chooser asks for them. */
const PICTURES = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/gif": [".gif"], "image/avif": [".avif"], "image/bmp": [".bmp"] };

/** imgQuire, as a kind of document. */
export function img(): Kind {
    return {
        key: "img",
        name: "imgQuire",
        main: MAIN,
        // its documents are told by the file their steps are kept in, never by their names
        opens: () => false,
        starts: () => [{ key: "picture", label: "picture", name: "Untitled", text: "", quire: false, said: "Picture", icon: "image" }],
        files: { description: "Pictures", accept: PICTURES, chooser: Object.keys(PICTURES).join(",") },
        row: "picture",
        takes: (file) => file.type in PICTURES,
        mount: mountEditor,
    };
}
