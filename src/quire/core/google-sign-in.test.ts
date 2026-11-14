// What signing in to Google is held to, with the window and the channel stood in for (Google is
// never reached): the address asks for drive.file alone, with response_type=token, the client ID,
// the exact redirect and a fresh random state; an answer is taken only with that state, and an
// answer for another request is passed over; Google's refusal is said plainly; the token is kept in
// the storage given (sessionStorage in the page) and taken as run out a minute early; and the page
// Google sends back to hands the fragment over and takes it out of the address. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import { AUTHORIZE, forgetToken, handBack, keepToken, NotSignedIn, readAnswer, readToken, redirectFor, SCOPE, signIn, TOKEN_KEY, type SignInWays } from "./google-sign-in";

/** A window and a channel in memory: what was opened, and a way to answer as Google would. */
function stand() {
    const opened: string[] = [];
    const heard = new Set<(hash: string) => void>();
    const ways: SignInWays = {
        open: (address) => void opened.push(address),
        listen: (each) => (heard.add(each), () => heard.delete(each)),
    };
    return { opened, ways, answer: (hash: string) => [...heard].forEach((each) => each(hash)), listening: () => heard.size };
}

test("the sign-in address asks for drive.file alone, for a token, back to the site's own page, with a fresh state", () => {
    const one = stand();
    signIn({ clientId: "123-abc.apps.googleusercontent.com", redirect: redirectFor("https://bybrooklyn.dev"), ways: one.ways });
    signIn({ clientId: "123-abc.apps.googleusercontent.com", redirect: redirectFor("https://bybrooklyn.dev"), ways: one.ways });
    const [first, second] = one.opened.map((address) => new URL(address));
    expect(`${first!.origin}${first!.pathname}`).toBe(AUTHORIZE);
    expect(Object.fromEntries(first!.searchParams)).toMatchObject({ client_id: "123-abc.apps.googleusercontent.com", redirect_uri: "https://bybrooklyn.dev/mdquire/drive/", response_type: "token", scope: SCOPE });
    expect(SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(first!.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
    expect(first!.searchParams.get("state")).not.toBe(second!.searchParams.get("state"));
});

test("only the answer with this request's state is taken; another's is passed over", async () => {
    const one = stand();
    const asked = signIn({ clientId: "id", redirect: "https://example.com/mdquire/drive/", ways: one.ways, now: () => 1_000_000 });
    const state = new URL(one.opened[0]!).searchParams.get("state")!;
    one.answer("#access_token=someone-elses&expires_in=3600&state=not-this-one");
    one.answer("#nothing=here");
    expect(one.listening()).toBe(1);
    one.answer(`#access_token=ya29.mine&token_type=Bearer&expires_in=3599&state=${state}`);
    expect(await asked.done).toEqual({ token: "ya29.mine", expires: 1_000_000 + 3_599_000 });
    expect(one.listening()).toBe(0);
});

test("Google's refusal, and a stopped sign-in, are said plainly", async () => {
    const one = stand();
    const asked = signIn({ clientId: "id", redirect: "r", ways: one.ways });
    one.answer(`#error=access_denied&state=${new URL(one.opened[0]!).searchParams.get("state")}`);
    const refused = await asked.done.catch((error) => error);
    expect(refused).toBeInstanceOf(NotSignedIn);
    expect(refused.message).toBe("Google was not given access.");
    const two = stand();
    const stopped = signIn({ clientId: "id", redirect: "r", ways: two.ways });
    stopped.cancel();
    expect((await stopped.done.catch((error) => error)).message).toBe("Signing in was stopped.");
    expect(two.listening()).toBe(0);
});

test("an answer is read from the fragment, an hour assumed when Google gives no time", () => {
    expect(readAnswer("#access_token=t&expires_in=10&state=s", 0)).toEqual({ token: "t", expires: 10_000, state: "s" });
    expect(readAnswer("#access_token=t", 0)).toEqual({ token: "t", expires: 3_600_000, state: undefined });
    expect(readAnswer("#error=access_denied&state=s")).toEqual({ error: "access_denied", state: "s" });
    expect(readAnswer("")).toBeUndefined();
});

test("the token is kept in the storage given, and taken as run out a minute before Google says", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
    keepToken(storage, { token: "t", expires: 100_000 });
    expect(kept.has(TOKEN_KEY)).toBe(true);
    expect(readToken(storage, 30_000)).toEqual({ token: "t", expires: 100_000 });
    expect(readToken(storage, 50_000)).toBeUndefined();
    forgetToken(storage);
    expect(readToken(storage, 0)).toBeUndefined();
    kept.set(TOKEN_KEY, "not json");
    expect(readToken(storage, 0)).toBeUndefined();
});

test("the page Google sends back to hands the fragment over, takes it out of the address and closes", () => {
    const done: string[] = [];
    const page = (hash: string) => ({ hash, post: (each: string) => void done.push(`post ${each}`), clear: () => void done.push("clear"), close: () => void done.push("close") });
    expect(handBack(page("#access_token=t&state=s"))).toBe("signed in");
    expect(done).toEqual(["post #access_token=t&state=s", "clear", "close"]);
    expect(handBack(page("#error=access_denied&state=s"))).toBe("not signed in");
    done.length = 0;
    expect(handBack(page(""))).toBe("nothing");
    expect(done).toEqual([]);
});
