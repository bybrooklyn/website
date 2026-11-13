// Signing in to Google for the Drive store, with no script of Google's and no server: OAuth 2.0's
// flow for JavaScript web apps, as Google's page "OAuth 2.0 for Client-side Web Applications"
// gives it. A small window opens at accounts.google.com/o/oauth2/v2/auth asking for the scope
// drive.file only (the app sees only the files it made) with response_type=token and a random
// state; Google sends the window back to the site's /mdquire/drive/ page with the access token in
// the address's fragment, which a server never sees. That page hands the fragment to the tab that
// asked, over a BroadcastChannel (mdQuire's pages are cross-origin isolated, so the window cannot
// reach back to its opener), and closes. The tab takes it only if the state is the one it sent.
//
// The token lasts about an hour (Google gives expires_in, 3600 seconds in its example). It is kept
// in this tab's sessionStorage only, never localStorage, so that it goes when the tab closes; when it
// runs out, the writer is asked to sign in again and nothing typed is lost meanwhile.

/** The one scope asked for: files the app made, and no others. */
export const SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Google's authorization endpoint for this flow. */
export const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
/** Where the token is kept in this tab's sessionStorage. */
export const TOKEN_KEY = "quire-drive-token";
/** The channel the sign-in window hands its answer back over. */
export const CHANNEL = "quire-drive-sign-in";
/** A token is taken as run out this long before Google says it does, so that a save never starts on one about to go. */
const MARGIN = 60_000;

/** An access token and when it runs out, in milliseconds since 1970. */
export interface Token {
    token: string;
    expires: number;
}

/** What came back in the fragment: a token, or Google's reason for none. */
export type Answer = ({ token: string; expires: number } | { error: string }) & { state?: string };

/** The page Google sends the sign-in window back to, on this site: it must be listed in the client ID's redirect URIs exactly. */
export function redirectFor(origin: string): string {
    return `${origin}/mdquire/drive/`;
}

/** A random state, 32 hex digits, to know the answer is to this request. */
export function newState(): string {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The address the sign-in window opens at. */
export function signInAddress(options: { clientId: string; redirect: string; state: string }): string {
    const query = new URLSearchParams({ client_id: options.clientId, redirect_uri: options.redirect, response_type: "token", scope: SCOPE, state: options.state, prompt: "select_account" });
    return `${AUTHORIZE}?${query}`;
}

/** Reads the fragment Google sent back, or undefined if it is not an answer at all. */
export function readAnswer(hash: string, now = Date.now()): Answer | undefined {
    const values = new URLSearchParams(hash.replace(/^#/, ""));
    const state = values.get("state") ?? undefined;
    const error = values.get("error");
    if (error) return { error, state };
    const token = values.get("access_token");
    if (!token) return undefined;
    const seconds = Number(values.get("expires_in"));
    return { token, expires: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000, state };
}

/** The token kept in this tab, if there is one and it has not run out. */
export function readToken(storage: Pick<Storage, "getItem"> | undefined, now = Date.now()): Token | undefined {
    try {
        const kept = JSON.parse(storage?.getItem(TOKEN_KEY) ?? "null") as Token | null;
        return kept && typeof kept.token === "string" && kept.expires - MARGIN > now ? kept : undefined;
    } catch {
        return undefined;
    }
}

/** Keeps a token in this tab. */
export function keepToken(storage: Pick<Storage, "setItem"> | undefined, token: Token) {
    try {
        storage?.setItem(TOKEN_KEY, JSON.stringify(token));
    } catch {
        // a tab that keeps nothing holds the token in memory only (drive-place.ts), until it closes
    }
}

/** Takes the token out of this tab. */
export function forgetToken(storage: Pick<Storage, "removeItem"> | undefined) {
    try {
        storage?.removeItem(TOKEN_KEY);
    } catch {
        // nothing was kept
    }
}

/** What signing in can be told, so that a test can stand in for the window and the channel. */
export interface SignInWays {
    open(address: string): void;
    listen(heard: (hash: string) => void): () => void;
}

/** The browser's own ways: a small window, and the channel. */
export const browserWays: SignInWays = {
    open: (address) => void window.open(address, "quire-google", "popup,width=480,height=640"),
    listen(heard) {
        const channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (event: MessageEvent<{ hash?: unknown }>) => typeof event.data?.hash === "string" && heard(event.data.hash);
        return () => channel.close();
    },
};

/** Google said no, or the writer closed the window: said in plain words. */
export class NotSignedIn extends Error {}

/** Starts signing in: opens the window, and gives the token once the answer with this request's state comes back. */
export function signIn(options: { clientId: string; redirect: string; ways?: SignInWays; now?: () => number }): { done: Promise<Token>; cancel(): void } {
    const ways = options.ways ?? browserWays;
    const state = newState();
    let stop = () => {};
    let refuse: (error: Error) => void = () => {};
    const done = new Promise<Token>((give, fail) => {
        refuse = fail;
        stop = ways.listen((hash) => {
            const answer = readAnswer(hash, options.now?.());
            // an answer to another request, from another tab, is not this one's
            if (!answer || answer.state !== state) return;
            stop();
            if ("error" in answer) fail(new NotSignedIn(answer.error === "access_denied" ? "Google was not given access." : "Google did not sign you in."));
            else give({ token: answer.token, expires: answer.expires });
        });
    });
    ways.open(signInAddress({ clientId: options.clientId, redirect: options.redirect, state }));
    return {
        done,
        cancel() {
            stop();
            refuse(new NotSignedIn("Signing in was stopped."));
        },
    };
}

/** For the page Google sends the window back to: hands the fragment over, takes it out of the address, and closes. Gives whether there was an answer. */
export function handBack(page: { hash: string; post(hash: string): void; clear(): void; close(): void }): "signed in" | "not signed in" | "nothing" {
    const answer = readAnswer(page.hash);
    if (!answer) return "nothing";
    page.post(page.hash);
    // the token leaves the address bar and the history at once
    page.clear();
    page.close();
    return "error" in answer ? "not signed in" : "signed in";
}
