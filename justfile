# Every recipe is the package.json script of the same name.
set shell := ["sh", "-eu", "-c"]

default:
    @just --list

dev:
    bun run dev

check:
    bun run check

build:
    bun run build

preview:
    bun run preview

# write and edit in the browser, then publish
edit:
    bun run edit

# add the pictures waiting in photos/
photos:
    bun run photos

# recount the language bar from GitHub
langs:
    bun run langs

# refresh project facts from GitHub
projects:
    bun run projects

# check, build and publish to production
deploy:
    bun run deploy

# publish to the preview branch
deploy-preview:
    bun run deploy:preview

# publish everything, drafts included, to its own preview address
deploy-drafts:
    bun run deploy:drafts

clean:
    rm -rf dist .astro
