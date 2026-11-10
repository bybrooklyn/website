// Adds photographs to the site.
//
//   1. Put pictures in photos/ (at the top of the repo). To say something
//      about one, put a text file with the same name beside it: pier.jpg and
//      pier.txt.
//   2. bun run photos   (also runs by itself before dev and build)
//
// Each new picture is saved into src/assets/photos/ upright, at most 3000 px
// on its long edge, with nothing embedded in it: the date it was taken is
// noted first, and everything else the camera wrote (location, camera, serial
// number) is thrown away. A small image model that runs on this computer then
// sorts it under one of the headings below. The original moves to
// photos/added/. Nothing in photos/ is ever committed.
//
// To take a photo off the site, delete its file from src/assets/photos/.
// To change a caption, put a text file with the photo's name in photos/.

import { mkdir, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { readExif } from "./exif";

/** The headings photos are sorted under, and how each is described to the model. Edit freely. */
const GROUPS: Record<string, string> = {
    nature: "a photo of nature, plants, trees or a landscape",
    city: "a photo of a city, a street or buildings",
    people: "a photo of a person or people",
    animals: "a photo of an animal",
    sky: "a photo of the sky, clouds, the sun or the moon",
    water: "a photo of the sea, a lake or a river",
    indoors: "a photo taken indoors, of a room or objects",
};

const root = resolve(new URL("..", import.meta.url).pathname);
const INBOX = join(root, "photos");
const ADDED = join(INBOX, "added");
const OUT = join(root, "src/assets/photos");
const DATA = join(root, "src/data/photos.json");

interface Photo {
    file: string;
    group?: string;
    taken?: string;
    caption?: string;
}

const slug = (name: string) => name.toLowerCase().replace(/\.\w+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
const names = async (folder: string) => (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => entry.name);

let photos = ((await Bun.file(DATA).json()) as { photos: Photo[] }).photos;
const before = JSON.stringify(photos);

// A photo whose picture has been deleted is off the site.
const present = new Set(await names(OUT));
const gone = photos.filter((photo) => !present.has(photo.file));
photos = photos.filter((photo) => present.has(photo.file));
for (const photo of gone) console.log(`removed  ${photo.file}`);

const waiting = await names(INBOX);
const pictures = waiting.filter((name) => /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i.test(name));
const notes = new Map(waiting.filter((name) => /\.txt$/i.test(name)).map((name) => [slug(name), name]));
if (pictures.length + notes.size > 0) await mkdir(ADDED, { recursive: true });

/** Ask the model which heading a picture belongs under. Loaded only when there is something new. */
let sorter: ((path: string) => Promise<string | undefined>) | undefined;
async function sort(path: string): Promise<string | undefined> {
    if (!sorter) {
        try {
            const { env, pipeline } = await import("@huggingface/transformers");
            // Kept outside node_modules so reinstalling packages does not fetch it again (about 290 MB, once).
            env.cacheDir = join(homedir(), ".cache", "bybrooklyn-photos");
            const classify = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", { dtype: "fp16" });
            const labels = Object.values(GROUPS);
            sorter = async (picture) => {
                const scores = (await classify(picture, labels)) as { label: string; score: number }[];
                const best = scores.sort((a, b) => b.score - a.score)[0];
                return Object.keys(GROUPS).find((group) => GROUPS[group] === best?.label);
            };
        } catch (error) {
            console.log(`The sorting model could not be loaded (${error instanceof Error ? error.message.split("\n")[0] : error}).`);
            console.log("Photos are still added, under no heading. Run this again when online to sort them.");
            sorter = async () => undefined;
        }
    }
    return sorter(path);
}

for (const name of pictures) {
    const source = join(INBOX, name);
    try {
        const picture = sharp(source, { failOn: "none" });
        const { taken } = readExif((await picture.metadata()).exif);
        let file = `${slug(name)}.jpg`;
        for (let copy = 2; present.has(file); copy++) file = `${slug(name)}-${copy}.jpg`;
        await mkdir(OUT, { recursive: true });
        await picture
            .rotate()
            .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 88, mozjpeg: true })
            .toFile(join(OUT, file));
        present.add(file);

        const note = notes.get(slug(name));
        const caption = note ? (await Bun.file(join(INBOX, note)).text()).trim() : "";
        if (note) {
            await rename(join(INBOX, note), join(ADDED, note));
            notes.delete(slug(name));
        }
        const group = await sort(join(OUT, file));
        photos.push({ file, group, taken, caption: caption || undefined });
        await rename(source, join(ADDED, name));
        console.log(`added    ${file}  ${group ?? "(unsorted)"}${taken ? `  ${taken}` : "  (no date in the file)"}${caption ? "  with caption" : ""}`);
    } catch {
        console.log(`skipped  ${name}: it could not be read as a picture. HEIC and camera RAW files need exporting to JPEG first.`);
    }
}

// A text file on its own changes the caption of a photo already on the site.
for (const [key, note] of notes) {
    const photo = photos.find((candidate) => candidate.file === `${key}.jpg`);
    if (!photo) {
        console.log(`waiting  ${note}: no photo with that name yet.`);
        continue;
    }
    photo.caption = (await Bun.file(join(INBOX, note)).text()).trim() || undefined;
    await rename(join(INBOX, note), join(ADDED, note));
    console.log(`caption  ${photo.file}`);
}

// Photos added while the model was unavailable get sorted once it is.
if (pictures.length > 0) {
    for (const photo of photos) if (!photo.group) photo.group = await sort(join(OUT, photo.file));
}

if (JSON.stringify(photos) !== before) await Bun.write(DATA, `${JSON.stringify({ photos }, null, 4)}\n`);
