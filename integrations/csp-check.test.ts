// Tests that the build's policy check finds what a page's policy would block, and a page that has lost its policy.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { problemsIn } from "./csp-check";

const hash = (body: string) => createHash("sha256").update(body).digest("base64");
const policy = (...hashes: string[]) => `<meta http-equiv="content-security-policy" content="script-src 'self' ${hashes.map((each) => `'sha256-${each}'`).join(" ")}">`;

test("an inline script whose hash the policy lists passes, and one it does not list is named", () => {
    const body = "console.info(1)";
    expect(problemsIn(`${policy(hash(body))}<script>${body}</script>`)).toEqual([]);
    expect(problemsIn(`${policy()}<script>${body}</script>`)).toEqual([`a <script> starting "console.info(1)"`]);
});

test("a script from a file and a block of JSON are not inline script", () => {
    expect(problemsIn(`${policy()}<script type="module" src="/a.js"></script><script type="application/json">{"a":1}</script>`)).toEqual([]);
});

test("a page with no policy passes only if it runs no script", () => {
    expect(problemsIn(`<style>p { color: red }</style><p>a mock-up</p>`)).toEqual([]);
    expect(problemsIn(`<script type="application/json">[]</script>`)).toEqual([]);
    expect(problemsIn(`<p>lost</p><script>go()</script>`)).toEqual(["a page with script and no content security policy"]);
    expect(problemsIn(`<script type="module" src="/a.js"></script>`)).toEqual(["a page with script and no content security policy"]);
});
