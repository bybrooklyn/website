// Adds photographs to the site.
//
//   1. Put pictures in photos/ (at the top of the repo). To say something
//      about one, put a text file with the same name beside it: pier.jpg and
//      pier.txt.
//   2. bun run photos   (also runs by itself before dev and build)
//
// Each new picture is saved into public/photos/ as an AVIF, upright and at
// most 2000 px on its long edge, with nothing embedded in it: the date it was
// taken is noted first, and everything else the camera wrote (location,
// camera, serial number) is thrown away. A second, smaller copy goes in
// public/photos/s/ for small screens. The original moves to photos/added/.
// Nothing in photos/ is ever committed.
//
// Pictures that are not photographs of mine (memes, screenshots, shitposts)
// go in photos/shitposts/ instead. They are prepared the same way and shown
// on the same page under their own heading.
//
// A friend's photographs go in photos/by-<name>/ (photos/by-dylan/). They are
// shown with the photographs, each credited to that name.
//
// To take a photo off the site, delete its file from public/photos/.
// To change a caption, put a text file with the photo's name in photos/.
//
// A screenshot for the setup page goes in photos/setup/, named desktop. It
// gets the same cleaning and lands in src/assets/setup/.

import { $ } from "bun";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { Photo } from "../src/lib/photos";
import { readExif } from "./exif";
import { root, slug as words, stem, writeJson } from "./lib";

const INBOX = join(root, "photos");
const ADDED = join(INBOX, "added");
const OUT = join(root, "public/photos");
// A smaller copy of each picture, for phones: 1200 px on its long edge.
const SMALL = join(OUT, "s");
const SMALL_EDGE = 1200;
const DATA = join(root, "src/data/photos.json");
const PICTURE = /\.(jpe?g|png|webp|avif|gif|tiff?|heic|heif|dng)$/i;

const slug = (name: string) => words(stem(name)) || "photo";
/** What is in a folder; a folder that is not there has nothing in it, and any other failure to read one stops the run. */
const entries = (folder: string) => readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
const names = async (folder: string) => (await entries(folder)).filter((entry) => entry.isFile()).map((entry) => entry.name);

/**
 * Open a picture. What sharp cannot read itself (iPhone HEIC, camera DNG) is
 * first turned into a JPEG by ImageMagick, which keeps the date it was taken.
 */
async function open(source: string): Promise<{ picture: Sharp; exif?: Buffer; clean: () => Promise<void> }> {
    try {
        if (/\.(heic|heif|dng)$/i.test(source)) throw new Error("not for sharp");
        const picture = sharp(source, { failOn: "none" });
        return { picture, exif: (await picture.metadata()).exif, clean: async () => {} };
    } catch {
        const converted = join(tmpdir(), `photo-${process.pid}-${crypto.randomUUID()}.jpg`);
        await $`magick ${source} -quality 95 ${converted}`.quiet();
        const picture = sharp(converted, { failOn: "none" });
        return { picture, exif: (await picture.metadata()).exif, clean: () => rm(converted, { force: true }) };
    }
}

let photos = ((await Bun.file(DATA).json()) as { photos: Photo[] }).photos;
const before = JSON.stringify(photos);

// A photo whose picture has been deleted is off the site. If the folder cannot be read at all (or
// is not there while photos are listed), the run stops here rather than take every photo off.
const present = new Set(photos.length > 0 ? (await readdir(OUT, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name) : await names(OUT));
for (const photo of photos.filter((candidate) => !present.has(candidate.file))) {
    await rm(join(SMALL, photo.file), { force: true });
    console.log(`removed  ${photo.file}`);
}
photos = photos.filter((photo) => present.has(photo.file));

const waiting = await names(INBOX);
const pictures = waiting.filter((name) => PICTURE.test(name));
const notes = new Map(waiting.filter((name) => /\.txt$/i.test(name)).map((name) => [slug(name), name]));
if (pictures.length + notes.size > 0) await mkdir(ADDED, { recursive: true });
if (pictures.length > 0) await mkdir(OUT, { recursive: true });
await mkdir(SMALL, { recursive: true });

/** `sub` is the folder inside photos/ it came from: none, "shitposts", or "by-" and a name for someone else's photographs. */
async function add(name: string, sub: string): Promise<void> {
    const source = join(INBOX, sub, name);
    const by = sub.startsWith("by-") ? sub[3]!.toUpperCase() + sub.slice(4) : undefined;
    try {
        const { picture, exif, clean } = await open(source);
        const { taken } = readExif(exif);
        let file = `${slug(name)}.avif`;
        for (let copy = 2; present.has(file); copy++) file = `${slug(name)}-${copy}.avif`;
        present.add(file);
        const upright = picture.rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
        // Effort 2: a little larger than the slowest setting would give, and several times quicker to make.
        const { width, height } = await upright.clone().avif({ quality: 58, effort: 2 }).toFile(join(OUT, file));
        await upright.clone().resize({ width: SMALL_EDGE, height: SMALL_EDGE, fit: "inside", withoutEnlargement: true }).avif({ quality: 58, effort: 2 }).toFile(join(SMALL, file));
        // One color, shown where the picture will be until it arrives.
        const { dominant } = await upright.clone().resize(32).stats();
        const color = `#${[dominant.r, dominant.g, dominant.b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
        await clean();

        const note = notes.get(slug(name));
        const caption = note ? (await Bun.file(join(INBOX, note)).text()).trim() : "";
        if (note) {
            await rename(join(INBOX, note), join(ADDED, note));
            notes.delete(slug(name));
        }
        photos.push({ file, width, height, color, taken, caption: caption || undefined, kind: sub === "shitposts" ? "shitpost" : undefined, by });
        await rename(source, join(ADDED, name));
        console.log(`added    ${file}${taken ? `  ${taken}` : "  (no date in the file)"}${caption ? "  with caption" : ""}`);
    } catch (error) {
        console.log(`skipped  ${name}: it could not be read as a picture (${error instanceof Error ? error.message.split("\n")[0] : error}).`);
    }
}

// Several at a time: encoding is the slow part and each one mostly uses a single core.
const queue: [string, string][] = pictures.map((name): [string, string] => [name, ""]);
const friends = (await entries(INBOX)).filter((entry) => entry.isDirectory() && entry.name.startsWith("by-")).map((entry) => entry.name);
for (const sub of ["shitposts", ...friends]) {
    for (const name of await names(join(INBOX, sub))) if (PICTURE.test(name)) queue.push([name, sub]);
}
if (queue.length > 0) {
    await mkdir(ADDED, { recursive: true });
    await mkdir(OUT, { recursive: true });
}
await Promise.all(
    Array.from({ length: 6 }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await add(...next);
    }),
);

// Any picture already on the site that has no smaller copy yet gets one, made from the full one.
const small = new Set(await names(SMALL));
const lacking = photos.filter((photo) => !small.has(photo.file));
await Promise.all(
    Array.from({ length: 6 }, async () => {
        for (let photo = lacking.shift(); photo; photo = lacking.shift()) {
            await sharp(join(OUT, photo.file)).resize({ width: SMALL_EDGE, height: SMALL_EDGE, fit: "inside", withoutEnlargement: true }).avif({ quality: 58, effort: 2 }).toFile(join(SMALL, photo.file));
            console.log(`smaller  ${photo.file}`);
        }
    }),
);

// A text file on its own changes the caption of a photo already on the site.
for (const [key, note] of notes) {
    const photo = photos.find((candidate) => candidate.file === `${key}.avif`);
    if (!photo) {
        console.log(`waiting  ${note}: no photo with that name yet.`);
        continue;
    }
    photo.caption = (await Bun.file(join(INBOX, note)).text()).trim() || undefined;
    await rename(join(INBOX, note), join(ADDED, note));
    console.log(`caption  ${photo.file}`);
}

// The screenshot for the setup page: cleaned the same way, kept under its own name.
for (const name of (await names(join(INBOX, "setup"))).filter((file) => PICTURE.test(file))) {
    const source = join(INBOX, "setup", name);
    try {
        const { picture, clean } = await open(source);
        await mkdir(join(root, "src/assets/setup"), { recursive: true });
        await picture.rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toFile(join(root, "src/assets/setup", `${slug(name)}.jpg`));
        await clean();
        await mkdir(join(ADDED, "setup"), { recursive: true });
        await rename(source, join(ADDED, "setup", name));
        console.log(`setup    ${slug(name)}.jpg`);
    } catch {
        console.log(`skipped  setup/${name}: it could not be read as a picture.`);
    }
}

if (JSON.stringify(photos) !== before) await writeJson(DATA, { photos });
