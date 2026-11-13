// The page for trying Google Drive without Google (src/pages/mdquire-drive-try.astro): mdQuire with
// a Drive kept in memory and a sign-in that answers at once. The Drive is left on the window as
// `driveTry`, so that a browser check can look at what it was sent.

import { accents } from "../data/theme";
import { css } from "../lib/color";
import { startApp } from "../quire/app";
import { memoryDrive } from "../quire/drive";

const memory = memoryDrive();
(window as unknown as { driveTry: typeof memory }).driveTry = memory;
const host = document.querySelector<HTMLElement>("#quire");
const names: Record<string, string> = { violet: "Violet", pink: "Pink", blue: "Blue", mint: "Mint", amber: "Amber" };
const colors = Object.entries(accents).map(([key, value]) => ({ name: names[key] ?? key, value: css(value) }));

if (host)
    void startApp(host, {
        colors,
        // a database of its own, so that nothing here mixes with documents kept by /mdquire/
        database: "quire-drive-try",
        top: document.querySelector<HTMLElement>(".quire-top") ?? undefined,
        drive: {
            clientId: "a stand-in for Google",
            connect: () => memory.drive,
            signIn: () => ({ done: new Promise((give) => setTimeout(() => give({ token: "stand-in", expires: Date.now() + 3_600_000 }), 300)), cancel() {} }),
        },
    });
