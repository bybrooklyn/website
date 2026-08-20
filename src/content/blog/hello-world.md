---
title: Hello world
description: A template post — copy this file, change the frontmatter, write.
published: 2026-08-20
draft: true
---

This is a draft. `draft: true` keeps it off the live site and out of the RSS feed,
but it still shows up on `/blog/` when you run `bun run dev`.

Delete this file or flip `draft` to `false` when you have something real to say.

## Frontmatter

- `title` and `description` are required — the description is the meta description and the RSS summary.
- `published` is required and sets the ordering.
- `updated` is optional; when set, it's what the footer shows as last modified.

```rust
fn main() {
    println!("code blocks are highlighted by shiki");
}
```
