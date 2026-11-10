set shell := ["sh", "-eu", "-c"]

default:
    @just --list

dev:
    bun run dev

check:
    bun run check

build:
    bun run build

preview: build
    bun run preview

# recount the language bar from GitHub
langs:
    bun run langs

clean:
    rm -rf dist .astro

# check, build and publish to production
deploy: check build
    bunx wrangler pages deploy

# publish a preview named after the current branch
deploy-preview: check build
    bunx wrangler pages deploy --branch "$(git rev-parse --abbrev-ref HEAD)"

# write a post and publish it
blog:
    bun run blog

# change any text on the site, then publish
edit:
    bun run edit
