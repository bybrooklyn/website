// Loaded before every test (bunfig.toml): a test has sixty seconds unless it sets a limit of its own.
// Bun's own limit is five, which a test that drives a browser passes on a quiet machine and misses on a
// busy one; and where the tests of a file share one page, the ones after a test that ran out of time
// failed with it. A test that gives its own limit keeps it.

import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(60_000);
