// When and from which commit the site was built, for the line at the foot of every page.
import { execFileSync } from "node:child_process";

function commit(): string | undefined {
    // Cloudflare Pages provides the hash; locally, ask git.
    const fromEnv = process.env.CF_PAGES_COMMIT_SHA;
    if (fromEnv) return fromEnv.slice(0, 7);
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
        return undefined;
    }
}

const now = new Date();

const timeFormat = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
});

export const build = {
    /** For the `datetime` attribute. */
    iso: now.toISOString(),
    /** "Nov 10, 2026, 18:04 UTC" */
    time: `${timeFormat.format(now)} UTC`,
    commit: commit(),
};
