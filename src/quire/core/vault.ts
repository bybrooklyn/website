// Locking documents with a passphrase before they leave the browser, for the Google Drive store.
// Only the browser's own Web Crypto is used: AES-256-GCM with a fresh random 96-bit nonce for every
// file written, and the key made from the passphrase by PBKDF2 with HMAC-SHA-256 over a random salt
// kept with the vault. The key is a CryptoKey the page cannot read back out (non-extractable), held
// in memory only; the passphrase itself is never kept.
//
// Every locked file starts with a small header saying how it was locked, so that the numbers can be
// raised later without losing what was written before:
//
//   bytes 0-1    "MQ"
//   byte  2      the version of this layout, now 1
//   bytes 3-6    PBKDF2 iterations, a whole number, high byte first
//   bytes 7-22   the vault's salt
//   bytes 23-34  this file's nonce
//   then         the locked bytes with GCM's 16-byte tag at the end
//
// The header, and a label naming what the file is for (the lock, the index, one document's random
// key), are authenticated with the contents: a file moved into another's place, or a header
// changed, fails to open as surely as a changed byte of text does.
//
// A wrong passphrase and a damaged file both make GCM refuse, so they are told apart by the lock:
// a small file holding a known sentence, opened first. If the lock does not open, the passphrase is
// wrong; if the lock opens and a document does not, the document was changed or damaged.

/** How files are locked now. A file says in its header how it was locked, so these can be raised. */
export const LOCKING = { version: 1, iterations: 600_000, saltBytes: 16, nonceBytes: 12 };

/** The length of the header in front of every locked file. */
export const HEADER_BYTES = 2 + 1 + 4 + LOCKING.saltBytes + LOCKING.nonceBytes;

/** What the lock file holds, locked: opening it proves the passphrase. */
const LOCK_WORDS = "mdQuire vault";

/** A key made from a passphrase, with the salt and iterations it was made with. */
export interface VaultKey {
    key: CryptoKey;
    salt: Uint8Array;
    iterations: number;
}

/** What a header says. */
export interface Header {
    version: number;
    iterations: number;
    salt: Uint8Array;
    nonce: Uint8Array;
}

/** The passphrase did not open the lock. */
export class WrongPassphrase extends Error {
    constructor() {
        super("That passphrase is wrong.");
    }
}

/** A locked file that the right key would not open, or that is not a locked file at all: changed or damaged. */
export class Damaged extends Error {}

const words = new TextEncoder();
// Web Crypto wants its byte arrays over a plain ArrayBuffer
const plain = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;

/** Random bytes from the browser's own source. */
export function randomBytes(count: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(count));
}

/** Writes a header. */
export function writeHeader(header: Header): Uint8Array {
    const bytes = new Uint8Array(HEADER_BYTES);
    bytes[0] = 0x4d; // M
    bytes[1] = 0x51; // Q
    bytes[2] = header.version;
    new DataView(bytes.buffer).setUint32(3, header.iterations);
    bytes.set(header.salt, 7);
    bytes.set(header.nonce, 7 + LOCKING.saltBytes);
    return bytes;
}

/** Reads a header from the front of a locked file, refusing what is not one or is of a layout not known here. */
export function readHeader(bytes: Uint8Array): Header {
    if (bytes.length < HEADER_BYTES + 16 || bytes[0] !== 0x4d || bytes[1] !== 0x51) throw new Damaged("not a locked file");
    if (bytes[2] !== LOCKING.version) throw new Damaged(`locked in a later way (${bytes[2]}) than this mdQuire knows`);
    const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(3);
    return { version: bytes[2]!, iterations, salt: bytes.slice(7, 7 + LOCKING.saltBytes), nonce: bytes.slice(7 + LOCKING.saltBytes, HEADER_BYTES) };
}

/**
 * Makes the key from a passphrase. The passphrase is put in Unicode's composed form first, so that
 * one typed with an accent on another keyboard makes the same key. The key cannot be read back out.
 */
export async function makeKey(passphrase: string, salt: Uint8Array, iterations = LOCKING.iterations): Promise<VaultKey> {
    const base = await crypto.subtle.importKey("raw", words.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: plain(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { key, salt, iterations };
}

/** AES-GCM with a 128-bit tag, as every file is locked: the one place the cipher is named. */
export async function gcm(direction: "encrypt" | "decrypt", key: CryptoKey, nonce: Uint8Array, data: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
    const params = { name: "AES-GCM", iv: plain(nonce), additionalData: plain(extra), tagLength: 128 };
    return new Uint8Array(direction === "encrypt" ? await crypto.subtle.encrypt(params, key, plain(data)) : await crypto.subtle.decrypt(params, key, plain(data)));
}

const joined = (one: Uint8Array, two: Uint8Array) => {
    const both = new Uint8Array(one.length + two.length);
    both.set(one);
    both.set(two, one.length);
    return both;
};

/** Locks bytes under a label. A fresh nonce is drawn each time; `nonce` is for tests alone. */
export async function seal(vault: VaultKey, label: string, data: Uint8Array, nonce: Uint8Array = randomBytes(LOCKING.nonceBytes)): Promise<Uint8Array> {
    const header = writeHeader({ version: LOCKING.version, iterations: vault.iterations, salt: vault.salt, nonce });
    return joined(header, await gcm("encrypt", vault.key, nonce, data, joined(header, words.encode(label))));
}

/** Opens bytes locked under a label, or throws Damaged. */
export async function unseal(vault: VaultKey, label: string, sealed: Uint8Array): Promise<Uint8Array> {
    const header = readHeader(sealed);
    const same = header.iterations === vault.iterations && header.salt.every((byte, at) => byte === vault.salt[at]);
    if (!same) throw new Damaged("locked with another key");
    try {
        return await gcm("decrypt", vault.key, header.nonce, sealed.subarray(HEADER_BYTES), joined(sealed.subarray(0, HEADER_BYTES), words.encode(label)));
    } catch {
        throw new Damaged("changed or damaged");
    }
}

/** Makes a new vault's key and its lock file, from a passphrase, with a new random salt. */
export async function makeLock(passphrase: string, iterations = LOCKING.iterations): Promise<{ vault: VaultKey; lock: Uint8Array }> {
    const vault = await makeKey(passphrase, randomBytes(LOCKING.saltBytes), iterations);
    return { vault, lock: await seal(vault, "lock", words.encode(LOCK_WORDS)) };
}

/** Opens a vault's lock with a passphrase and gives the key, or throws WrongPassphrase; a lock that is not one at all is Damaged. */
export async function openLock(passphrase: string, lock: Uint8Array): Promise<VaultKey> {
    const header = readHeader(lock);
    const vault = await makeKey(passphrase, header.salt, header.iterations);
    try {
        await unseal(vault, "lock", lock);
    } catch {
        throw new WrongPassphrase();
    }
    return vault;
}

/** Locks text, as UTF-8. */
export const sealText = (vault: VaultKey, label: string, text: string) => seal(vault, label, words.encode(text));

/** Opens locked UTF-8 text. */
export async function unsealText(vault: VaultKey, label: string, sealed: Uint8Array): Promise<string> {
    const bytes = await unseal(vault, label, sealed);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Damaged("not text");
    }
}
