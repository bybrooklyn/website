// What the Google client ID is held to: empty (Google Drive not set up), or the shape Google gives a
// web application's client ID, so that a client secret or a whole address pasted by mistake is
// caught before it ships. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { GOOGLE_CLIENT_ID } from "./drive-config";

test("the client ID is empty, or a client ID ending in .apps.googleusercontent.com and nothing else", () => {
    expect(GOOGLE_CLIENT_ID === "" || /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID)).toBe(true);
    expect(GOOGLE_CLIENT_ID).not.toMatch(/GOCSPX|secret|https?:/i);
});
