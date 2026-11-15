// The page for the cut-out (src/pages/cutout.astro): the piece on its host, offered the site's own colors
// to lay a cut-out on, besides white and black.

import { createCutoutPage } from "../quire/img/cutout/page";
import { accents, theme } from "../data/theme";
import { hex } from "../lib/color";

const host = document.querySelector<HTMLElement>("#cutout");
if (host)
    createCutoutPage(host, {
        colors: [
            { name: "White", value: "#ffffff" },
            { name: "Black", value: "#000000" },
            { name: "The site's ground", value: hex(theme.ground) },
            { name: "Violet", value: hex(accents.violet) },
            { name: "Pink", value: hex(accents.pink) },
            { name: "Blue", value: hex(accents.blue) },
            { name: "Mint", value: hex(accents.mint) },
            { name: "Amber", value: hex(accents.amber) },
        ],
    });
