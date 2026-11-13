// What locking is held to. The cipher gives the published answers of the GCM specification's test
// cases (McGrew and Viega, cases 13, 14 and 16, which NIST's validation uses); the key made from a
// passphrase is the one PBKDF2-HMAC-SHA-256's published vectors give (RFC 7914 section 11, and the
// widely used "password"/"salt" ones), shown by opening with that known key what the made key
// locked. A locked file round trips; one changed byte anywhere, a file moved to another label, a
// header changed, or another key, each refuses to open; the nonce is fresh every time; a wrong
// passphrase is said as exactly that and a damaged lock is not. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { Damaged, gcm, HEADER_BYTES, LOCKING, makeKey, makeLock, openLock, readHeader, seal, sealText, unseal, unsealText, WrongPassphrase, type VaultKey } from "./vault";

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const raw = (bytes: Uint8Array) => crypto.subtle.importKey("raw", bytes as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
const text = (value: string) => new TextEncoder().encode(value);
// a quick key for the tests that are not about the iterations
const quick = (passphrase = "a passphrase for tests") => makeKey(passphrase, text("sixteen byte slt"), 1000);

test("the cipher gives the GCM specification's answers for cases 13, 14 and 16", async () => {
    const zero = await raw(new Uint8Array(32));
    expect(toHex(await gcm("encrypt", zero, new Uint8Array(12), new Uint8Array(0), new Uint8Array(0)))).toBe("530f8afbc74536b9a963b4f1c4cb738b");
    expect(toHex(await gcm("encrypt", zero, new Uint8Array(12), new Uint8Array(16), new Uint8Array(0)))).toBe("cea7403d4d606b6e074ec5d3baf39d18" + "d0d1c8a799996bf0265b98b5d48ab919");
    const key = await raw(hex("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308"));
    const plainText = hex("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39");
    const sealed = await gcm("encrypt", key, hex("cafebabefacedbaddecaf888"), plainText, hex("feedfacedeadbeeffeedfacedeadbeefabaddad2"));
    expect(toHex(sealed)).toBe("522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662" + "76fc6ece0f4e1768cddf8853bb2d551b");
    expect(toHex(await gcm("decrypt", key, hex("cafebabefacedbaddecaf888"), sealed, hex("feedfacedeadbeeffeedfacedeadbeefabaddad2")))).toBe(toHex(plainText));
});

test("the key made from a passphrase is PBKDF2-HMAC-SHA-256's published one", async () => {
    // the key cannot be read out, so what it locks is opened with the published key
    const vectors = [
        { passphrase: "passwd", salt: "salt", iterations: 1, key: "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc" },
        { passphrase: "password", salt: "salt", iterations: 1, key: "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b" },
        { passphrase: "password", salt: "salt", iterations: 4096, key: "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a" },
        { passphrase: "Password", salt: "NaCl", iterations: 80000, key: "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56" },
    ];
    for (const vector of vectors) {
        const made = await makeKey(vector.passphrase, text(vector.salt), vector.iterations);
        const sealed = await seal(made, "check", text("known words"));
        const opened = await gcm("decrypt", await raw(hex(vector.key)), sealed.subarray(23, HEADER_BYTES), sealed.subarray(HEADER_BYTES), new Uint8Array([...sealed.subarray(0, HEADER_BYTES), ...text("check")]));
        expect(new TextDecoder().decode(opened)).toBe("known words");
    }
});

test("the key cannot be read back out of the page, and is made with at least 600,000 iterations", async () => {
    expect(LOCKING.iterations).toBeGreaterThanOrEqual(600_000);
    const made = await quick();
    expect(made.key.extractable).toBe(false);
    expect(made.key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(await crypto.subtle.exportKey("raw", made.key).then(() => "read", () => "refused")).toBe("refused");
});

test("a locked file opens to what was locked, its header saying how it was locked, the nonce fresh every time", async () => {
    const vault = await quick();
    const first = await sealText(vault, "doc-1", "Café \u{1F600}\n");
    const second = await sealText(vault, "doc-1", "Café \u{1F600}\n");
    expect(await unsealText(vault, "doc-1", first)).toBe("Café \u{1F600}\n");
    const header = readHeader(first);
    expect(header).toMatchObject({ version: 1, iterations: 1000 });
    expect(new TextDecoder().decode(header.salt)).toBe("sixteen byte slt");
    expect(header.nonce.length).toBe(12);
    expect(toHex(readHeader(second).nonce)).not.toBe(toHex(header.nonce));
    expect(toHex(first)).not.toBe(toHex(second));
    expect(first.length).toBe(HEADER_BYTES + text("Café \u{1F600}\n").length + 16);
});

test("one changed byte anywhere, another label, another key or a changed header refuses to open, as damaged", async () => {
    const vault = await quick();
    const sealed = await seal(vault, "doc-1", text("the words"));
    const refused = async (key: VaultKey, label: string, bytes: Uint8Array) => unseal(key, label, bytes).then(() => "opened", (error) => (error instanceof Damaged ? "damaged" : String(error)));
    for (let at = 0; at < sealed.length; at++) {
        const changed = sealed.slice();
        changed[at]! ^= 0x01;
        expect(await refused(vault, "doc-1", changed)).toBe("damaged");
    }
    expect(await refused(vault, "doc-2", sealed)).toBe("damaged");
    expect(await refused(await quick("another passphrase"), "doc-1", sealed)).toBe("damaged");
    expect(await refused(vault, "doc-1", sealed.subarray(0, 40))).toBe("damaged");
    expect(await refused(vault, "doc-1", text("plain words, never locked, long enough to have a header"))).toBe("damaged");
});

test("the lock opens with the right passphrase only; a wrong one is said as exactly that, a damaged lock as damaged", async () => {
    const { vault, lock } = await makeLock("correct horse battery staple", 1000);
    const opened = await openLock("correct horse battery staple", lock);
    // the key from the lock opens what the first key locked
    expect(await unsealText(opened, "index", await sealText(vault, "index", "{}"))).toBe("{}");
    const wrong = await openLock("correct horse battery stapler", lock).catch((error) => error);
    expect(wrong).toBeInstanceOf(WrongPassphrase);
    expect(wrong.message).toBe("That passphrase is wrong.");
    const damaged = lock.slice();
    damaged[0] = 0;
    expect(await openLock("correct horse battery staple", damaged).catch((error) => error)).toBeInstanceOf(Damaged);
});

test("a passphrase typed with a composed or a separate accent makes the same key", async () => {
    const { lock } = await makeLock("café au lait, deux sucres", 1000);
    expect(await openLock("café au lait, deux sucres", lock).then(() => "opened")).toBe("opened");
});

test("two locks made from one passphrase have different salts", async () => {
    const one = await makeLock("the same passphrase", 1000);
    const two = await makeLock("the same passphrase", 1000);
    expect(toHex(one.vault.salt)).not.toBe(toHex(two.vault.salt));
    expect(await unseal(two.vault, "lock", one.lock).then(() => "opened", () => "refused")).toBe("refused");
});
