set shell := ["sh", "-eu", "-c"]

# dev server with hot reload
serve:
    bun run dev

build:
    bun run build

# type-check .astro/.ts and validate content frontmatter
check:
    bun run check

preview: build
    bun run preview

install:
    bun install

clean:
    rm -rf dist .astro
