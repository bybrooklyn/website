/** Drafts show in `bun run dev`, and in a build run with SHOW_DRAFTS=1 (used to preview PDFs). */
export const showDrafts: boolean = import.meta.env.DEV || process.env.SHOW_DRAFTS === "1";

/** A filter for collections: everything, minus drafts when they are not being shown. */
export const visible = ({ data }: { data: { draft?: boolean } }): boolean => showDrafts || !data.draft;
