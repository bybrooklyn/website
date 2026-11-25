/**
 * The pages made for trying and testing (/mdquire-kinds/, /mdquire-drive-try/, /mdquire-dictation/)
 * are built on the dev server and by `bun run build:test`, for the browser tests that open them in the
 * built site, and by no other build, so they never go out with a deploy.
 */
export const testPages: boolean = import.meta.env.DEV || process.env.TEST_PAGES === "1";
