// What the Google Drive place decides, apart from the dialog it draws: where Drive stands (not set
// up without a client ID, then signed out, locked, open), what is wrong with a passphrase being made
// (too short, not the same twice) or typed (empty, and nothing more: an old one is never refused for
// its length), and that the dialog's words keep the site's writing rules, say what Google can see,
// and say plainly that a lost passphrase cannot be recovered. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { tellsIn } from "../md/check/tells";
import { DRIVE_WORDS, driveState, passphraseProblem, SHORTEST } from "./drive-place";

test("with no client ID Drive is not set up, whatever else; then signed out, locked, or open", () => {
    expect(driveState("", true, true)).toBe("not set up");
    expect(driveState("id", false, true)).toBe("signed out");
    expect(driveState("id", true, false)).toBe("locked");
    expect(driveState("id", true, true)).toBe("open");
});

test("a new passphrase must be long enough and the same twice; one being typed must only be there", () => {
    expect(SHORTEST).toBeGreaterThanOrEqual(12);
    expect(passphraseProblem("", "")).toBe("Type your passphrase.");
    expect(passphraseProblem("short one", "short one")).toBe("Use at least 12 characters.");
    expect(passphraseProblem("long enough phrase", "long enough phrasf")).toBe("The two do not match.");
    expect(passphraseProblem("long enough phrase", "long enough phrase")).toBeUndefined();
    // characters, not bytes or UTF-16 units: twelve emoji are twelve characters
    expect(passphraseProblem("\u{1F600}".repeat(12), "\u{1F600}".repeat(12))).toBeUndefined();
    expect(passphraseProblem("old", undefined)).toBeUndefined();
});

test("the dialog's words keep the site's writing rules, say what Google can see, and that a lost passphrase is lost", () => {
    for (const [name, words] of Object.entries(DRIVE_WORDS)) expect({ name, tells: tellsIn(words, false) }).toEqual({ name, tells: [] });
    expect(DRIVE_WORDS.seen).toContain("how many files");
    expect(DRIVE_WORDS.seen).toContain("their sizes");
    expect(DRIVE_WORDS.seen).toContain("when they change");
    expect(DRIVE_WORDS.lost).toBe("If you forget it, nobody can open your documents again, not even you.");
});
