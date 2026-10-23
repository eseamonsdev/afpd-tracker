# Missing pages

`make build` renders `src/404.njk` into `public/404.html`, using the shared
site header and `public/css/not-found.css`. Edit the template for wording and
links. The page is excluded from collections and sitemaps and marked noindex.

Cloudflare Workers serves the page through `assets.not_found_handling:
"404-page"` in `wrangler.jsonc`. The existing Worker passes requests through
to `env.ASSETS.fetch(request)`, which applies this setting. Unknown URLs keep
their requested address and receive HTTP 404 with the custom page body.
The existing hostname redirects still run first.

Build and publish to staging in the normal way. Once staging has been checked,
use `make promote-staging` for production. No separate Cloudflare dashboard
error-page upload or redirect rule is needed.

To check locally, run `npx wrangler dev --local`, then request an invented
root path and a nested path. Both should return 404 and the custom page.
Check a real page and a static asset too; they should still return 200.

Reference: https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/
