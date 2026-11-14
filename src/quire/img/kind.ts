// imgQuire as a kind of document for the core's app (core/kind.ts): its documents are `.quire` files
// that keep their steps in steps.json with the original beside them, which the stores say without
// opening them; a picture chosen, pasted or dropped becomes one; its row on the shelf says "picture";
// and its editor is editor.ts in the core's frame.
//
//   startApp(host, { kinds: [markdown({ colors, sample }), img()], top });

import type { Kind } from "../core/kind";
import { MAIN, mountEditor } from "./editor";

/** The kinds of picture it opens, as a file chooser asks for them: those the browser reads, and HEIC, which the HEIC module reads (codec-run.ts). */
const PICTURES = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/gif": [".gif"], "image/avif": [".avif"], "image/bmp": [".bmp"], "image/jxl": [".jxl"], "image/heic": [".heic"], "image/heif": [".heif"] };

/** imgQuire, as a kind of document. */
export function img(): Kind {
    return {
        key: "img",
        name: "imgQuire",
        main: MAIN,
        // its documents are told by the file their steps are kept in, never by their names
        opens: () => false,
        starts: () => [{ key: "picture", label: "picture", name: "Untitled", text: "", quire: false, said: "Picture", icon: "image" }],
        files: { description: "Pictures", accept: PICTURES, chooser: [...Object.keys(PICTURES), ".heic", ".heif", ".jxl"].join(",") },
        row: "picture",
        // a phone's HEIC often comes with no type at all, so its name counts too
        takes: (file) => file.type in PICTURES || /\.(heic|heif)$/i.test(file.name),
        mount: mountEditor,
    };
}
