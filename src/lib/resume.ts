import { getEntry, type CollectionEntry } from "astro:content";
import { showDrafts } from "./drafts";

export type Resume = CollectionEntry<"resume">;

/** The resume, or nothing while it is a draft outside development. */
export async function getResume(): Promise<Resume | undefined> {
    const resume = await getEntry("resume", "resume");
    return resume && (showDrafts || !resume.data.draft) ? resume : undefined;
}

export const resumePdf = "/resume/charlotte-resume.pdf";
