// The photographs on /photos/. scripts/photos.ts writes the list
// (src/data/photos.json) and the pictures (src/assets/photos/) from whatever
// is dropped into the photos/ folder.

import type { ImageMetadata } from "astro";
import data from "../data/photos.json";

interface Entry {
    file: string;
    /** The heading the sorting model put it under. */
    group?: string;
    /** The date it was taken, if the picture said. */
    taken?: string;
    caption?: string;
}

export interface Photo extends Entry {
    image: ImageMetadata;
}

const images = import.meta.glob<ImageMetadata>("../assets/photos/*.{jpg,jpeg,png,webp,avif}", { eager: true, import: "default" });

/** Every photo that has its picture, newest first; those without a date last. */
export const photos: Photo[] = (data.photos as Entry[])
    .flatMap((entry) => {
        const image = images[`../assets/photos/${entry.file}`];
        return image ? [{ ...entry, image }] : [];
    })
    .sort((a, b) => (b.taken ?? "").localeCompare(a.taken ?? ""));

/** Photos under their headings, the fullest heading first; unsorted ones last. */
export const groups: { title: string; photos: Photo[] }[] = [];
for (const photo of photos) {
    const title = photo.group ?? "";
    let group = groups.find((candidate) => candidate.title === title);
    if (!group) groups.push((group = { title, photos: [] }));
    group.photos.push(photo);
}
groups.sort((a, b) => Number(a.title === "") - Number(b.title === "") || b.photos.length - a.photos.length);
