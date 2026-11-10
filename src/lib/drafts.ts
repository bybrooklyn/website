/** Drafts show in `bun run dev`, and in a build run with SHOW_DRAFTS=1 (used to preview PDFs). */
export const showDrafts: boolean = import.meta.env.DEV || process.env.SHOW_DRAFTS === "1";
