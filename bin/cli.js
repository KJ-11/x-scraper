#!/usr/bin/env node

const [command, ...rest] = process.argv.slice(2);

// Rewrite argv so commands see their args at expected positions
process.argv = [process.argv[0], process.argv[1], ...rest];

const commands = {
  login:    '../commands/login.js',
  scrape:   '../commands/scrape.js',
  fetch:    '../commands/fetch-url.js',
  articles: '../commands/fetch-articles.js',
  process:  '../commands/process.js',
  batch:    '../commands/batch.js',
};

if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(`x-scraper — Scrape and analyze X/Twitter profiles

Usage: x-scraper <command> [options]

Commands:
  login              Set up authentication cookies
  scrape <handle>    Scrape tweets from a profile
  fetch <url>        Fetch a single tweet/thread by URL
  articles <handle>  Fetch X articles from scraped data (macOS only)
  process <handle>   Generate markdown reports from scraped data
  batch [file]       Process multiple handles from a file

Examples:
  x-scraper login
  x-scraper scrape @elonmusk --max=500 --since=2025-01-01
  x-scraper fetch https://x.com/user/status/123456789
  x-scraper process elonmusk --output=./reports
  x-scraper batch handles.txt --skip-articles

Environment:
  X_SCRAPER_AUTH  Path to auth.json (default: ~/.x-scraper/auth.json)

Run x-scraper <command> --help for command-specific options.`);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  console.log(pkg.version);
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error('Run x-scraper --help for available commands.');
  process.exit(1);
}

await import(commands[command]);
