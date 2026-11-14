// Every rule for what looks private, both ways: it finds what it is for, and it leaves ordinary words,
// dates, times, versions, prices and sentences alone. And the findings give the words they touch,
// each word to one finding only, and a label alone on its line gives the next line.
// (Machine addresses are put together here from their parts, so that no file of the site holds one.)

import { expect, test } from "bun:test";
import { entropy, lookPrivate, luhn, randomLike, type Kind } from "./private";

/** Lines of words from plain text, one line to each string. */
const linesOf = (...texts: string[]) => texts.map((text) => ({ words: text.split(" ").filter(Boolean).map((word) => ({ text: word })) }));
/** The kinds found in one line, with their text. */
const found = (...texts: string[]) => lookPrivate(linesOf(...texts) as never).map((each) => `${each.kind}: ${each.text}`);
const ip = (...parts: number[]) => parts.join(".");

const FOUND: [Kind, string, string][] = [
    ["email", "Email: someone@example.com", "someone@example.com"],
    ["email", "write to first.last+tag@mail.co.uk today", "first.last+tag@mail.co.uk"],
    ["phone", "Call +1 415 555 0132 now", "+1 415 555 0132"],
    ["phone", "Phone (020) 7946 0958", "(020) 7946 0958"],
    ["phone", "mobile 555-0132", "555-0132"],
    ["phone", "Tel 07700 900123", "07700 900123"],
    ["key", "Token ghp_9f8a7c6b5d4e3f2a1b0cXyZ123", "ghp_9f8a7c6b5d4e3f2a1b0cXyZ123"],
    ["key", "OPENAI sk-proj-AbCdEf0123456789GhIjKl", "sk-proj-AbCdEf0123456789GhIjKl"],
    ["key", "aws AKIAIOSFODNN7EXAMPLE here", "AKIAIOSFODNN7EXAMPLE"],
    ["key", "stripe sk_live_51HxYzAbCdEf0123", "sk_live_51HxYzAbCdEf0123"],
    ["key", "slack xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij"],
    ["key", "jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4", "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4"],
    ["key", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"],
    ["card", "Card 4111 1111 1111 1111 exp", "4111 1111 1111 1111"],
    ["card", "5500-0000-0000-0004", "5500-0000-0000-0004"],
    ["address", "1600 Pennsylvania Avenue, Washington, DC 20500", "1600 Pennsylvania Avenue, Washington, DC 20500"],
    ["address", "Ship to 221B Baker Street", "221B Baker Street"],
    ["address", "Springfield, IL 62704", "Springfield, IL 62704"],
    ["ip", `Server ${ip(203, 0, 113, 42)} is up`, ip(203, 0, 113, 42)],
    ["ip", "v6 2001:db8:85a3::8a2e:370:7334 ok", "2001:db8:85a3::8a2e:370:7334"],
    ["label", "Password: hunter2", "hunter2"],
    ["label", "api key = 9a8b7c6d", "9a8b7c6d"],
    ["label", "token=abc123", "abc123"],
    ["random", "id Zx81Qp0LmN27vBt5Wq9Rs4", "Zx81Qp0LmN27vBt5Wq9Rs4"],
    ["random", "sha 3b18e512dba79e4c8300dd08aeb37f8e728b8dad", "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"],
];

const ORDINARY = [
    "Account settings",
    "Forgot your password?",
    "Change password",
    "The meeting is on 2026-11-14 at 10:30:15",
    "Released 14/11/2026 as version 1.24.1",
    "Total $1,234.56 for 3 items",
    "internationalization and localization",
    "ThisIsCamelCaseIdentifierName",
    "Page 12 of 340",
    "Order 12345 shipped",
    "Press Ctrl+C to copy",
    "Open the Settings menu and choose Privacy",
    "Read more at example dot com",
    "Version 4.2.0 build 1187",
    "Width 1920 Height 1080",
    "4111 1111 1111 1112",
    "I walked down Main to the station",
    "Room 101",
];

test("each rule finds what it is for", () => {
    for (const [kind, line, text] of FOUND) expect(found(line)).toContain(`${kind}: ${text}`);
});

test("ordinary words, dates, times, versions, prices and sentences are left alone", () => {
    for (const line of ORDINARY) expect([line, found(line)]).toEqual([line, []]);
});

test("a finding gives the words it touches, each word to one finding only", () => {
    const lines = linesOf("Email: someone@example.com or +1 415 555 0132");
    const findings = lookPrivate(lines as never);
    expect(findings.map((each) => [each.kind, each.words.map((place) => place.word)])).toEqual([
        ["email", [1]],
        ["phone", [3, 4, 5, 6]],
    ]);
});

test("a label alone on its line gives the next line", () => {
    expect(found("Password", "correct horse battery")).toEqual(["label: correct horse battery"]);
    expect(found("Password", "")).toEqual([]);
});

test("Luhn, entropy and the look of a random key", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(entropy("aaaa")).toBe(0);
    expect(entropy("abcd")).toBe(2);
    expect(randomLike("Zx81Qp0LmN27vBt5Wq9Rs4")).toBe(true);
    expect(randomLike("internationalization")).toBe(false);
    expect(randomLike("short1A")).toBe(false);
});
