// Google Drive as the app offers it: whether it is set up, signed in and open, and the one dialog
// (dialog.ts) that takes the writer from signed out to an open vault. The dialog grows from what
// was pressed. Its first step says what Google can and cannot see and signs in through a small
// window (google-sign-in.ts); the same dialog then grows into the passphrase, asked once for this
// tab and never kept, with a second field when the vault is new. When the token runs out mid-work,
// the dialog opens on its first step alone, and the writer's text waits to be saved meanwhile.
//
// What it does is wired by app.ts; how it decides (which step, what is wrong with a passphrase) is
// pure and tested here.

import { openDialog, type Dialog } from "./dialog";
import { googleDrive, type Drive } from "./drive";
import { GOOGLE_CLIENT_ID } from "./drive-config";
import { forgetToken, keepToken, readToken, redirectFor, signIn, type Token } from "./google-sign-in";
import { findVault, openVault, type DriveStore } from "./store-drive";
import { make } from "./ui";
import { WrongPassphrase } from "./vault";

/** The shortest passphrase taken: the key is only as strong as what it is made from. */
export const SHORTEST = 12;

/** Where Google Drive stands for this tab. */
export type DriveState = "not set up" | "signed out" | "locked" | "open";

/** Where Google Drive stands: no client ID, no token, no key, or ready. */
export function driveState(clientId: string, token: boolean, store: boolean): DriveState {
    if (!clientId) return "not set up";
    if (!token) return "signed out";
    return store ? "open" : "locked";
}

/** What is wrong with a passphrase being made or typed, in a few plain words, or nothing. */
export function passphraseProblem(passphrase: string, again: string | undefined): string | undefined {
    if (!passphrase) return "Type your passphrase.";
    if (again === undefined) return undefined;
    if ([...passphrase].length < SHORTEST) return `Use at least ${SHORTEST} characters.`;
    if (passphrase !== again) return "The two do not match.";
    return undefined;
}

/** What the page can give the Drive place, so that a test page can stand in for Google. */
export interface DriveOptions {
    clientId?: string;
    /** Drive over a way to get the token; Google's own if not given. */
    connect?: (token: () => string | undefined) => Drive;
    /** Signs in and gives a token; the small window if not given. */
    signIn?: () => { done: Promise<Token>; cancel(): void };
    /** Where the token is kept; this tab's sessionStorage if not given. */
    storage?: Storage;
    /** PBKDF2 iterations for a new vault; for tests alone. */
    iterations?: number;
}

/** The words of the dialog, in one place for her to read. */
export const DRIVE_WORDS = {
    title: "Google Drive",
    about: "Keep documents in your Google Drive, locked with a passphrase in this browser before they are sent.",
    seen: "Google can see that you use mdQuire, how many files you keep, their sizes and when they change. It cannot read their names or what is in them.",
    signIn: "Sign in with Google",
    waiting: "Finish signing in in the window that opened. If none opened, let this site open pop-ups and try again.",
    again: "Your sign-in to Google has run out. Sign in again to go on saving; your writing is kept here meanwhile.",
    makeTitle: "Make a passphrase",
    make: `Your documents are locked with this passphrase before they go to Google Drive. Use at least ${SHORTEST} characters.`,
    openTitle: "Your passphrase",
    open: "Type the passphrase your documents in Google Drive are locked with.",
    lost: "If you forget it, nobody can open your documents again, not even you.",
    kept: "It is not kept anywhere. It is asked for again in each new tab.",
    passphrase: "Passphrase",
    passphraseAgain: "The same again",
    makeButton: "Make it",
    openButton: "Open",
    working: "Opening",
    notSetUp: "Google Drive is not set up yet.",
};

/** The Drive place: its state, its store once open, and the dialog that opens it. */
export function drivePlace(options: DriveOptions & { onSignedIn?: () => void } = {}) {
    const clientId = options.clientId ?? GOOGLE_CLIENT_ID;
    const storage = options.storage ?? (() => {
        try {
            return globalThis.sessionStorage;
        } catch {
            return undefined;
        }
    })();
    // a tab that keeps nothing still holds the token here, until it closes
    let held: Token | undefined;
    const token = () => (readToken(storage) ?? (held && held.expires - 60_000 > Date.now() ? held : undefined))?.token;
    let store: DriveStore | undefined;
    let dialog: Dialog | undefined;
    const drive = (options.connect ?? ((get) => googleDrive(get)))(token);
    const startSignIn = options.signIn ?? (() => signIn({ clientId, redirect: redirectFor(location.origin) }));

    const state = () => driveState(clientId, !!token(), !!store);

    /** A paragraph of the dialog. */
    const line = (text: string, className = "") => make("p", className, text);
    const field = (label: string, autocomplete: "new-password" | "current-password") => {
        const row = make("label", "quire-drive-row");
        row.append(make("span", "quire-drive-label", label));
        const input = make("input", "quire-link-field");
        input.type = "password";
        input.autocomplete = autocomplete;
        input.spellcheck = false;
        // the editor's keys are not this field's
        input.addEventListener("keydown", (event) => event.stopPropagation());
        row.append(input);
        return { row, input };
    };

    /**
     * Opens the dialog out of `from` and gives the store once the vault is open, or undefined if the
     * writer stops. With `again`, the token has run out mid-work and only signing in is asked.
     */
    function open(from?: HTMLElement, again = false): Promise<DriveStore | undefined> {
        if (state() === "not set up") return Promise.resolve(undefined);
        if (state() === "open" && !again) return Promise.resolve(store);
        return new Promise((answer) => {
            let step: "sign in" | "passphrase" = token() && !again ? "passphrase" : "sign in";
            let fresh = false;
            let first: HTMLInputElement | undefined;
            let second: HTMLInputElement | undefined;
            let busy = false;
            let asking: { cancel(): void } | undefined;
            const said = line("", "quire-drive-said");
            said.setAttribute("role", "status");
            const button = () => dialog?.actions.querySelector<HTMLButtonElement>(".quire-dialog-action");

            const signInBody = () => [line(again ? DRIVE_WORDS.again : DRIVE_WORDS.about), line(DRIVE_WORDS.seen, "quire-drive-quiet"), said];
            /** The passphrase step, in place of the first: one field, or two for a new vault. */
            const passphraseBody = async () => {
                said.textContent = DRIVE_WORDS.working;
                const found = await findVault(drive);
                fresh = !found.lock;
                const one = field(DRIVE_WORDS.passphrase, fresh ? "new-password" : "current-password");
                first = one.input;
                const parts: Node[] = [line(fresh ? DRIVE_WORDS.make : DRIVE_WORDS.open), line(DRIVE_WORDS.lost), one.row];
                if (fresh) {
                    const two = field(DRIVE_WORDS.passphraseAgain, "new-password");
                    second = two.input;
                    parts.push(two.row);
                } else second = undefined;
                said.textContent = "";
                parts.push(line(DRIVE_WORDS.kept, "quire-drive-quiet"), said);
                for (const input of [first, second]) input?.addEventListener("keydown", (event) => event.key === "Enter" && (event.preventDefault(), press()));
                return parts;
            };
            const showPassphrase = async (grower?: HTMLElement) => {
                step = "passphrase";
                const parts = await passphraseBody();
                if (!dialog) return;
                const holder = dialog.element.querySelector<HTMLElement>(".quire-dialog-title");
                dialog.change(() => {
                    if (holder) holder.textContent = fresh ? DRIVE_WORDS.makeTitle : DRIVE_WORDS.openTitle;
                    dialog!.body.replaceChildren(...parts);
                    const action = button();
                    if (action) action.textContent = fresh ? DRIVE_WORDS.makeButton : DRIVE_WORDS.openButton;
                }, grower);
                first?.focus();
            };

            async function press() {
                if (busy) return;
                const action = button();
                if (step === "sign in") {
                    said.textContent = DRIVE_WORDS.waiting;
                    asking?.cancel();
                    const now = startSignIn();
                    asking = now;
                    let got: Token;
                    try {
                        got = await now.done;
                    } catch (error) {
                        if (asking === now) said.textContent = error instanceof Error ? error.message : String(error);
                        return;
                    }
                    held = got;
                    keepToken(storage, got);
                    options.onSignedIn?.();
                    if (again && store) {
                        answer(store);
                        void dialog?.close();
                        return;
                    }
                    busy = true;
                    try {
                        await showPassphrase(action ?? undefined);
                    } catch (error) {
                        step = "sign in";
                        said.textContent = error instanceof Error ? error.message : String(error);
                    } finally {
                        busy = false;
                    }
                    return;
                }
                const problem = passphraseProblem(first?.value ?? "", fresh ? (second?.value ?? "") : undefined);
                if (problem) {
                    said.textContent = problem;
                    (problem.includes("match") ? second : first)?.focus();
                    return;
                }
                busy = true;
                if (action) action.disabled = true;
                said.textContent = DRIVE_WORDS.working;
                try {
                    store = await openVault(drive, first!.value, { iterations: options.iterations, onSignInNeeded: () => void expired() });
                    // the passphrase leaves the page's fields at once
                    for (const input of [first, second]) if (input) input.value = "";
                    answer(store);
                    void dialog?.close();
                } catch (error) {
                    said.textContent = error instanceof WrongPassphrase ? error.message : `It could not be opened: ${error instanceof Error ? error.message : String(error)}`;
                    first?.select();
                } finally {
                    busy = false;
                    if (action) action.disabled = false;
                }
            }

            dialog = openDialog(from, {
                title: step === "sign in" ? DRIVE_WORDS.title : DRIVE_WORDS.openTitle,
                body: step === "sign in" ? signInBody() : [said],
                className: "quire-drive-dialog",
                action: { label: step === "sign in" ? DRIVE_WORDS.signIn : DRIVE_WORDS.openButton, press: () => void press() },
                dismiss: "Not now",
                onClose: () => {
                    asking?.cancel();
                    for (const input of [first, second]) if (input) input.value = "";
                    dialog = undefined;
                    answer(state() === "open" ? store : undefined);
                },
            });
            if (step === "passphrase") void showPassphrase().catch((error) => (said.textContent = error instanceof Error ? error.message : String(error)));
        });
    }

    /** The token was refused mid-work: it is forgotten, and the writer is asked to sign in again. */
    async function expired() {
        held = undefined;
        forgetToken(storage);
        if (dialog?.isOpen()) return;
        await open(undefined, true);
    }

    return {
        state,
        /** The opened store, kept while the token is renewed, or undefined while locked. */
        store: () => store,
        open,
        /** Takes the key out of memory and forgets the token: Google Drive is locked and signed out in this tab. */
        signOut() {
            store?.lockAway();
            store = undefined;
            held = undefined;
            forgetToken(storage);
        },
    };
}
