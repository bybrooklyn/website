// The page Google sends the sign-in window back to (src/pages/mdquire/drive.astro): the fragment
// goes to the mdQuire tab that asked, over a BroadcastChannel, leaves the address at once, and the
// window closes; if the browser keeps it open, it says the window can be closed.

import { CHANNEL, handBack } from "../quire/core/google-sign-in";

const said = document.querySelector("#said");
const result = handBack({
    hash: location.hash,
    post(hash) {
        const channel = new BroadcastChannel(CHANNEL);
        channel.postMessage({ hash });
        channel.close();
    },
    clear: () => history.replaceState(null, "", location.pathname),
    close: () => window.close(),
});
if (said) said.textContent = result === "signed in" ? "Signed in. You can close this window." : result === "not signed in" ? "Not signed in. You can close this window." : "This page is used when mdQuire signs in to Google.";
