import { getEntry, type CollectionEntry } from "astro:content";
import { showDrafts } from "./drafts";

export type Resume = CollectionEntry<"resume">;

/** The resume, or nothing while it is a draft outside development. */
export async function getResume(): Promise<Resume | undefined> {
    const resume = await getEntry("resume", "resume");
    return resume && (showDrafts || !resume.data.draft) ? resume : undefined;
}

/** Printed from the resume page by integrations/resume-pdf.ts, at build time and on the dev server. */
export const resumePdf = "/resume/charlotte-resume.pdf";
