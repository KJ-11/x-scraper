# x-scraper

Scrape and analyze X/Twitter profiles, threads, and articles. Zero dependencies.

Fetches tweets via X's internal GraphQL API using your browser cookies, then generates structured markdown reports — overview files, individual thread breakdowns, and full article extractions.

## Setup

**Requirements:** Node.js 18+, macOS (for article fetching via Safari — everything else works cross-platform).

```bash
git clone https://github.com/yourusername/x-scraper.git
cd x-scraper
npm link  # optional: makes `x-scraper` available globally
```

### Authentication

x-scraper uses your X/Twitter session cookies. You need to grab two values from your browser:

```bash
x-scraper login
# or: node bin/cli.js login
```

This will prompt you for `auth_token` and `ct0` cookie values.

**To find them:**
1. Open Safari → go to x.com (logged in)
2. Safari > Settings > Advanced > check "Show features for web developers"
3. Develop > Show Web Inspector > Storage > Cookies > x.com
4. Copy the values for `auth_token` and `ct0`

Auth is saved to `~/.x-scraper/auth.json`. Override the path with the `X_SCRAPER_AUTH` environment variable.

## Usage

If installed globally via `npm link`:

```bash
x-scraper <command> [options]
```

Or run directly:

```bash
node bin/cli.js <command> [options]
```

### Scrape a profile

Fetch tweets from a user's timeline:

```bash
x-scraper scrape @username
x-scraper scrape username --max=500 --since=2025-01-01
```

| Option | Default | Description |
|--------|---------|-------------|
| `--max=N` | 200 | Maximum tweets to fetch |
| `--since=YYYY-MM-DD` | 14 days ago | Only fetch tweets after this date |

Output: `./data/<handle>-<date>.json`

Automatically resumes if the output file already exists. Exits with code 2 on rate limit so batch scripts can detect and stop.

### Fetch a single tweet or thread

```bash
x-scraper fetch https://x.com/user/status/123456789
x-scraper fetch https://x.com/user/status/123456789 --json --save
```

| Option | Description |
|--------|-------------|
| `--no-articles` | Skip fetching linked X articles |
| `--save` | Save raw data to `./data/urls/` |
| `--json` | Output JSON instead of markdown |

Outputs markdown to stdout by default. Automatically detects threads and fetches the full conversation.

### Fetch X articles

Extract full article content from tweets that link to X articles (uses Safari + AppleScript, macOS only):

```bash
x-scraper articles username
x-scraper articles username --delay=15
```

| Option | Default | Description |
|--------|---------|-------------|
| `--delay=N` | 10 | Seconds to wait for page load |

Requires running `scrape` first. Articles are saved to `./data/articles/`.

### Generate markdown reports

Process scraped data into structured markdown files:

```bash
x-scraper process username
x-scraper process username --output=./reports --min-likes=100
```

| Option | Default | Description |
|--------|---------|-------------|
| `--output=DIR` | `./output` | Output directory |
| `--min-likes=N` | 50 | Minimum likes threshold |
| `--min-views=N` | 10000 | Minimum views threshold |
| `--threads-only` | — | Only include threads |
| `--since=YYYY-MM-DD` | — | Filter tweets by date |

Generates:
- `<handle>-top-posts.md` — overview with top articles, threads, and standalone posts
- `<handle>-article-<id>.md` — individual article files
- `<date>-<handle>-<slug>.md` — individual thread files

### Batch processing

Process multiple handles from a file:

```bash
x-scraper batch handles.txt
x-scraper batch handles.txt --skip-articles --output=./reports
```

| Option | Default | Description |
|--------|---------|-------------|
| `--skip-articles` | — | Skip article fetching |
| `--start=N` | 0 | Resume from handle index N |
| `--output=DIR` | — | Output directory for markdown |

The handles file should have one handle per line (with or without `@`). Processes in batches of 3 with cooldowns between handles (60s) and batches (120s) to avoid rate limits.

## Full pipeline

```bash
# 1. Set up auth (one-time)
x-scraper login

# 2. Scrape tweets
x-scraper scrape @username --max=500

# 3. Fetch linked articles (optional, macOS only)
x-scraper articles username

# 4. Generate reports
x-scraper process username --output=./reports
```

Or batch everything:

```bash
x-scraper batch handles.txt --output=./reports
```

## Rate limits

The scraper uses polite delays (5-8s between pages, 60s between handles in batch mode). If you hit a rate limit:

- Single scrape: saves progress and exits with code 2. Re-run to resume.
- Batch mode: stops and tells you the `--start=N` value to resume.
- Article fetching uses Safari (not the API), so it has separate rate limits.

## Data format

Scraped tweets are saved as JSON with this structure:

```json
{
  "id": "1234567890",
  "text": "Tweet content...",
  "created_at": "Mon Jan 01 00:00:00 +0000 2025",
  "metrics": { "likes": 100, "retweets": 20, "replies": 5, "views": 5000, "bookmarks": 10 },
  "media": [{ "type": "photo", "url": "..." }],
  "urls": ["https://example.com"],
  "is_thread": true,
  "thread_id": "1234567890",
  "thread_position": 1,
  "thread_length": 5
}
```

## License

MIT
