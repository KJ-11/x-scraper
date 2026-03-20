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

## Key patterns

- Auth stored at `~/.x-scraper/auth.json` (override with `X_SCRAPER_AUTH` env var)
- Data written to `./data/` relative to cwd
- Commands parse their own args from `process.argv.slice(2)` — cli.js rewrites argv before importing
- Rate limit: scrape exits with code 2, batch detects this and stops
- Article fetching uses Safari AppleScript (macOS only)
