// Run before a deploy: what goes live is what is committed on main, so a deploy from another branch
// or with changes not yet committed is refused, with the reason said.
//
//   bun scripts/guard.ts        // exits 1 and says why, or says nothing

import { root } from "./lib";

/** Why a deploy from this state is refused, or nothing if it may go ahead. `status` is `git status --porcelain`. */
export function refusal(branch: string, status: string): string | undefined {
    if (branch !== "main") return `This is the branch "${branch}". Deploys are made from main.`;
    const changed = status.split("\n").filter((line) => line.trim() !== "");
    if (changed.length > 0) return `${changed.length === 1 ? "One file has" : `${changed.length} files have`} changes that are not committed. Commit them, or put them aside, and deploy again.`;
    return undefined;
}

if (import.meta.main) {
    const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString().trim();
    const why = refusal(git("rev-parse", "--abbrev-ref", "HEAD"), git("status", "--porcelain"));
    if (why) {
        console.error(`Not deployed. ${why}`);
        process.exit(1);
    }
}
