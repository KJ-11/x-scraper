# x-scraper

CLI tool to scrape and analyze X/Twitter profiles, threads, and articles.

## Architecture

Zero-dependency Node.js CLI (ESM). Uses X's internal GraphQL API with browser cookie auth.

```
bin/cli.js          — CLI entry point, routes subcommands
lib/api.js          — Bearer token, feature flags, header builder
lib/auth.js         — Load/save auth credentials (~/.x-scraper/auth.json)
lib/twitter.js      — API calls (getUserId, fetchUserTweets, fetchTweetDetail) + tweet parsing
commands/login.js   — Interactive cookie setup
commands/scrape.js  — Scrape a user's timeline to JSON
commands/fetch-url.js     — Fetch single tweet/thread by URL
commands/fetch-articles.js — Fetch X articles via Safari (macOS only)
commands/process.js — Generate markdown from scraped JSON
commands/batch.js   — Batch process multiple handles
```

## Key Patterns

- Auth stored at `~/.x-scraper/auth.json` (override with `X_SCRAPER_AUTH` env var)
- Data written to `./data/` relative to cwd
- Commands parse their own args from `process.argv.slice(2)` — cli.js rewrites argv before importing
- Rate limit: scrape exits with code 2, batch detects this and stops
- Article fetching uses Safari AppleScript (macOS only)

## Conventions

- Pure ESM (type: module in package.json)
- Zero external dependencies — stdlib only
- No build step, no transpilation
- Files: kebab-case. Functions: camelCase.

## Commands

| Task | Command |
|------|---------|
| Login (set cookies) | `node bin/cli.js login` |
| Scrape user timeline | `node bin/cli.js scrape <handle>` |
| Fetch single tweet/thread | `node bin/cli.js fetch-url <url>` |
| Fetch X articles | `node bin/cli.js fetch-articles <handle>` |
| Process JSON → Markdown | `node bin/cli.js process <handle>` |
| Batch process handles | `node bin/cli.js batch <handle1> <handle2> ...` |

## Vault Integration

Output from `process` and `batch` commands generates markdown files. These are typically moved to `Code/Vault/Research/Articles/` for the Vault's research workflow (extract insights, route actions to relevant project `actions.md` files).

## Troubleshooting

- **Auth expired:** Re-run `node bin/cli.js login` with fresh cookies from browser
- **Rate limited (exit code 2):** Wait ~15 min before retrying. Batch mode auto-stops on rate limit.
- **Article fetch fails:** Requires Safari on macOS. Check System Settings > Privacy > Automation > Terminal > Safari is enabled.

## Lessons Learned

_(Add entries as the project progresses. Format: what happened and what to do instead.)_
