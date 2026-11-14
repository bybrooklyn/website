// What the calls to Google Drive are held to, against answers made up here (Google is never called
// and no real token is used): each call goes to www.googleapis.com with the token in the
// Authorization header and never in an address or a message; files are made with a multipart upload
// in the app's folder and written with a media upload, every revision kept; searches escape their
// quotes; a file's bytes are read between two looks at its revision; a refused token is
// SignInNeeded, with no token it is asked for before anything is sent; too many requests, a full
// Drive and a file too large are said plainly. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { googleDrive, LARGEST, multipart, quoted, SignInNeeded } from "./drive";

const TOKEN = "ya29.test-token-not-real";
type Seen = { url: URL; method: string; auth: string | null; type: string | null; body: string };

/** A made-up Drive answering by address, keeping every request it is sent. */
function answering(answer: (seen: Seen) => Response | Promise<Response>) {
    const seen: Seen[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const body = init?.body instanceof Blob ? await init.body.text() : init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init?.body ?? "");
        const each = { url: new URL(url), method: init?.method ?? "GET", auth: headers.get("Authorization"), type: headers.get("Content-Type"), body };
        seen.push(each);
        return answer(each);
    };
    return { seen, drive: googleDrive(() => TOKEN, fetcher) };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("a search escapes its quotes and backslashes, and a multipart upload holds the metadata then the bytes", async () => {
    expect(quoted("it's a \\ test")).toBe("'it\\'s a \\\\ test'");
    const body = await multipart({ name: "abc", parents: ["folder1"] }, new Uint8Array([65, 66]), "edge").text();
    expect(body).toBe('--edge\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"abc","parents":["folder1"]}\r\n--edge\r\nContent-Type: application/octet-stream\r\n\r\nAB\r\n--edge--');
});

test("folders and files are found, made, read and written with the calls Drive's reference gives", async () => {
    let revision = 1;
    const { seen, drive } = answering(({ url, method }) => {
        if (url.pathname === "/drive/v3/files" && method === "GET") return json({ files: [{ id: "f1", name: "mdQuire", modifiedTime: "2026-01-02T03:04:05.000Z" }] });
        if (url.pathname === "/drive/v3/files" && method === "POST") return json({ id: "f2" });
        if (url.pathname === "/upload/drive/v3/files") return json({ id: "d1", headRevisionId: "r1" });
        if (url.pathname === "/upload/drive/v3/files/d1") return json({ headRevisionId: `r${++revision}` });
        if (url.pathname === "/drive/v3/files/d1" && url.searchParams.get("alt") === "media") return new Response(new Uint8Array([1, 2, 3]));
        if (url.pathname === "/drive/v3/files/d1") return json({ headRevisionId: `r${revision}` });
        if (url.pathname === "/drive/v3/files/d1/revisions") return json({ revisions: [{ id: "r1" }, { id: "r2" }] });
        if (url.pathname === "/drive/v3/files/d1/revisions/r1") return method === "GET" ? new Response(new Uint8Array([9])) : json({ id: "r1" });
        return json({}, 404);
    });
    expect(await drive.folders("mdQuire")).toEqual([{ id: "f1", name: "mdQuire", modified: Date.parse("2026-01-02T03:04:05.000Z"), size: undefined }]);
    expect(seen[0]!.url.searchParams.get("q")).toBe("name = 'mdQuire' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    expect(await drive.folder("mdQuire")).toBe("f2");
    expect(JSON.parse(seen[1]!.body)).toEqual({ name: "mdQuire", mimeType: "application/vnd.google-apps.folder" });
    expect(await drive.create("0123", new Uint8Array([65]), "f2")).toEqual({ id: "d1", revision: "r1" });
    const made = seen[2]!;
    expect(made.url.searchParams.get("uploadType")).toBe("multipart");
    expect(made.url.searchParams.get("keepRevisionForever")).toBe("true");
    expect(made.type).toMatch(/^multipart\/related; boundary=quire\d+$/);
    expect(made.body).toContain('{"name":"0123","parents":["f2"],"mimeType":"application/octet-stream"}');
    expect(await drive.write("d1", new Uint8Array([66]))).toBe("r2");
    expect(seen[3]!.method).toBe("PATCH");
    expect(seen[3]!.url.searchParams.get("uploadType")).toBe("media");
    expect(seen[3]!.url.searchParams.get("keepRevisionForever")).toBe("true");
    expect(seen[3]!.type).toBe("application/octet-stream");
    expect(await drive.read("d1")).toEqual({ bytes: new Uint8Array([1, 2, 3]), revision: "r2" });
    expect(await drive.revisions("d1")).toEqual(["r1", "r2"]);
    expect(await drive.readRevision("d1", "r1")).toEqual(new Uint8Array([9]));
    await drive.release("d1", "r1");
    expect(JSON.parse(seen.at(-1)!.body)).toEqual({ keepForever: false });
    await drive.children("f1");
    expect(seen.at(-1)!.url.searchParams.get("q")).toBe("'f1' in parents and trashed = false");
    for (const each of seen) {
        expect(each.url.origin).toBe("https://www.googleapis.com");
        expect(each.auth).toBe(`Bearer ${TOKEN}`);
        expect(each.url.href).not.toContain(TOKEN);
    }
});

test("bytes read while the file changed are read again, so that they are surely the revision given", async () => {
    let looks = 0;
    const { drive } = answering(({ url }) => {
        if (url.searchParams.get("alt") === "media") return new Response(new Uint8Array([looks]));
        looks++;
        // the revision moves on between the first two looks, then stays
        return json({ headRevisionId: looks < 2 ? "r1" : "r2" });
    });
    expect(await drive.read("d1")).toEqual({ bytes: new Uint8Array([3]), revision: "r2" });
});

test("a refused token is SignInNeeded, and with no token nothing is sent at all", async () => {
    const { drive } = answering(() => json({ error: { code: 401 } }, 401));
    expect(await drive.revision("d1").catch((error) => error)).toBeInstanceOf(SignInNeeded);
    const sent: string[] = [];
    const none = googleDrive(
        () => undefined,
        async (url) => (sent.push(url), json({})),
    );
    expect(await none.children("f1").catch((error) => error)).toBeInstanceOf(SignInNeeded);
    expect(sent).toEqual([]);
});

test("too many requests, a full Drive, a missing file, a lost connection and a file too large are said plainly, never with the token", async () => {
    const said = async (answer: () => Response | Promise<Response>) => {
        const drive = googleDrive(() => TOKEN, async () => answer());
        return drive.revision("d1").then(() => "", (error) => String(error));
    };
    const reason = (status: number, value: string) => json({ error: { errors: [{ reason: value }], message: `echo ${TOKEN}` } }, status);
    expect(await said(() => reason(403, "userRateLimitExceeded"))).toContain("too many requests");
    expect(await said(() => reason(429, "rateLimitExceeded"))).toContain("too many requests");
    expect(await said(() => reason(403, "storageQuotaExceeded"))).toContain("your Google Drive is full");
    expect(await said(() => json({}, 404))).toContain("no longer in Google Drive");
    expect(await said(() => json({}, 500))).toContain("Google Drive answered 500");
    expect(await said(() => Promise.reject(new Error(`failed with Bearer ${TOKEN}`)))).toContain("could not be reached");
    for (const each of [await said(() => reason(403, "x")), await said(() => Promise.reject(new Error(TOKEN)))]) expect(each).not.toContain(TOKEN);
    const { seen, drive } = answering(() => json({}));
    expect(await drive.write("d1", new Uint8Array(LARGEST + 1)).then(() => "", String)).toContain("over 5 MB");
    expect(seen).toEqual([]);
});
