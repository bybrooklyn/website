// The site's dev server, for the real page beside the text in `bun run edit`. If something already
// answers at the address it is used and never stopped. Otherwise Astro is asked to start one in
// the background, and the editor stops that one, and only that one, when it ends.
//
// Astro writes the server it runs for a folder in .astro/dev.json. A server counts as started here
// only when that file names a new background process after the start; `astro dev stop` is not
// used, since it stops whatever the file names then, which may be a server someone else started.

import { $ } from "bun";
import { join } from "node:path";

/** The server Astro has written down for this folder, if any. */
async function written(root: string): Promise<{ pid: number; background: boolean } | undefined> {
    try {
        return JSON.parse(await Bun.file(join(root, ".astro/dev.json")).text());
    } catch {
        return undefined;
    }
}

/** Makes sure the site answers at `address`, and gives back what stops the server if it was started here (else nothing). */
export async function preview(root: string, address: string): Promise<() => void> {
    const up = () => fetch(address).then(() => true, () => false);
    if (await up()) return () => {};
    const before = (await written(root))?.pid;
    // --background returns once the server is up; without it this would never come back.
    await $`bunx astro dev --background`.cwd(root).nothrow().quiet();
    const after = await written(root);
    let started = after?.background && after.pid !== before ? after.pid : undefined;
    for (let tries = 0; tries < 40 && !(await up()); tries++) await Bun.sleep(250);
    return () => {
        if (started === undefined) return;
        const pid = started;
        started = undefined;
        // Astro starts it as the head of a process group of its own, so the whole group is stopped.
        for (const target of [-pid, pid]) {
            try {
                process.kill(target, "SIGTERM");
                return;
            } catch {
                // no such group: try the process alone
            }
        }
    };
}
