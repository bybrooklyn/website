// The photographs on /photos/. The list (order, captions, albums, tags, and
// what the camera recorded) is src/data/photos.json; the pictures are in
// src/assets/photos/. Both are written by the editor (`bun run edit`).

import type { ImageMetadata } from "astro";
import data from "../data/photos.json";

export interface PhotoEntry {
    file: string;
    caption?: string;
    album?: string;
    tags?: string[];
    /** Read from the picture when it was added: date taken and exposure. */
    taken?: string;
    focal?: number;
    aperture?: number;
    shutter?: string;
    iso?: number;
}

export interface Photo extends PhotoEntry {
    image: ImageMetadata;
    tags: string[];
}

const images = import.meta.glob<ImageMetadata>("../assets/photos/*.{jpg,jpeg,png,webp,avif}", { eager: true, import: "default" });

/** Every photo that has its picture, in the order they were arranged. */
export const photos: Photo[] = (data.photos as PhotoEntry[]).flatMap((entry) => {
    const image = images[`../assets/photos/${entry.file}`];
    return image ? [{ ...entry, tags: entry.tags ?? [], image }] : [];
});

/** Albums in the order their first photo appears. Photos without one come first, untitled. */
export const albums: { title: string; photos: Photo[] }[] = [];
for (const photo of photos) {
    const title = photo.album ?? "";
    let album = albums.find((candidate) => candidate.title === title);
    if (!album) albums.push((album = { title, photos: [] }));
    album.photos.push(photo);
}
albums.sort((a, b) => Number(b.title === "") - Number(a.title === ""));

export const tags: string[] = [...new Set(photos.flatMap((photo) => photo.tags))].sort();

/** "35 mm · f/2.8 · 1/250 s · ISO 400", from whatever the camera recorded. */
export function exposure(photo: PhotoEntry): string {
    return [
        photo.focal && `${photo.focal} mm`,
        photo.aperture && `f/${photo.aperture}`,
        photo.shutter && `${photo.shutter} s`,
        photo.iso && `ISO ${photo.iso}`,
    ]
        .filter(Boolean)
        .join(" · ");
}
