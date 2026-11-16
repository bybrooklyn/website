// The page for the QR code maker and reader (src/pages/qr.astro): the piece on its host, offered the site's
// own light colors as grounds for a code, besides white and clear.

import { createQrPage } from "../quire/qr/page";
import { accents } from "../data/theme";
import { hex } from "../lib/color";

const host = document.querySelector<HTMLElement>("#qr");
if (host)
    createQrPage(host, {
        grounds: [
            { name: "Violet", value: hex(accents.violet) },
            { name: "Pink", value: hex(accents.pink) },
            { name: "Blue", value: hex(accents.blue) },
            { name: "Mint", value: hex(accents.mint) },
            { name: "Amber", value: hex(accents.amber) },
        ],
    });
