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

# --- cloudflare pages ---------------------------------------------------

# one-time browser login (or export CLOUDFLARE_API_TOKEN instead)
login:
    bunx wrangler login

whoami:
    bunx wrangler whoami

# deploy to production
deploy: check build
    bunx wrangler pages deploy

# deploy to a preview URL named after the current git branch
deploy-preview: check build
    bunx wrangler pages deploy --branch "$(git rev-parse --abbrev-ref HEAD)"

# what's already deployed
deployments:
    bunx wrangler pages deployment list
