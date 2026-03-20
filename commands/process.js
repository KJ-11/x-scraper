import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = './data';
const ARTICLES_DIR = './data/articles';

// Parse CLI args
const args = process.argv.slice(2);
const handle = (args.find(a => !a.startsWith('--')) || '').replace(/^@/, '');
const minLikes = parseInt(args.find(a => a.startsWith('--min-likes='))?.split('=')[1] || '50');
const minViews = parseInt(args.find(a => a.startsWith('--min-views='))?.split('=')[1] || '10000');
const threadsOnly = args.includes('--threads-only');
const since = args.find(a => a.startsWith('--since='))?.split('=')[1];
const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] || './output';

if (!handle) {
  console.log('Usage: x-scraper process <handle> [options]');
  console.log('');
  console.log('Generate markdown reports from scraped tweet data.');
  console.log('');
  console.log('Options:');
  console.log('  --min-likes=N       Minimum likes threshold (default: 50)');
  console.log('  --min-views=N       Minimum views threshold (default: 10000)');
  console.log('  --threads-only      Only include threads');
  console.log('  --since=YYYY-MM-DD  Only include tweets after this date');
  console.log('  --output=DIR        Output directory (default: ./output)');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

// Find most recent data file
const files = readdirSync(DATA_DIR)
  .filter(f => f.startsWith(handle) && f.endsWith('.json'))
  .sort()
  .reverse();

if (!files.length) {
  console.log(`No data found for @${handle}. Run \`x-scraper scrape ${handle}\` first.`);
  process.exit(1);
}

let tweets = JSON.parse(readFileSync(join(DATA_DIR, files[0]), 'utf-8'));
console.log(`Loaded ${tweets.length} tweets from ${files[0]}`);

// Load article content
const articleMap = new Map();
if (existsSync(ARTICLES_DIR)) {
  for (const f of readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.json'))) {
    const article = JSON.parse(readFileSync(join(ARTICLES_DIR, f), 'utf-8'));
    articleMap.set(article.article_id, article);
  }
  console.log(`Loaded ${articleMap.size} articles`);
}

// Apply time filter
if (since) {
  const sinceDate = new Date(since);
  tweets = tweets.filter(t => new Date(t.created_at) >= sinceDate);
  console.log(`Filtered to ${tweets.length} tweets since ${since}`);
}

// Filter for high-value content
const isHighValue = (t) => {
  if (t.is_retweet) return false;
  if (threadsOnly && !t.is_thread) return false;
  return t.metrics.likes >= minLikes || t.metrics.views >= minViews || (t.is_thread && t.thread_length >= 3);
};

// Group threads
const threadGroups = new Map();
const standalonePosts = [];
const articlePosts = [];

for (const tweet of tweets) {
  if (!isHighValue(tweet)) continue;

  const tweetArticleIds = (tweet.article_ids || []).filter(id => articleMap.has(id));
  if (tweetArticleIds.length) {
    articlePosts.push({ tweet, articles: tweetArticleIds.map(id => articleMap.get(id)) });
  }

  if (tweet.is_thread && tweet.thread_id) {
    if (!threadGroups.has(tweet.thread_id)) threadGroups.set(tweet.thread_id, []);
    threadGroups.get(tweet.thread_id).push(tweet);
  } else {
    standalonePosts.push(tweet);
  }
}

standalonePosts.sort((a, b) => b.metrics.likes - a.metrics.likes);
articlePosts.sort((a, b) => b.tweet.metrics.likes - a.tweet.metrics.likes);

const sortedThreads = [...threadGroups.entries()]
  .map(([id, tweets]) => {
    tweets.sort((a, b) => a.thread_position - b.thread_position);
    const totalLikes = tweets.reduce((sum, t) => sum + t.metrics.likes, 0);
    return { id, tweets, totalLikes };
  })
  .sort((a, b) => b.totalLikes - a.totalLikes);

// Format helpers
function fmtDate(dateStr) {
  try { return new Date(dateStr).toISOString().split('T')[0]; }
  catch { return 'unknown'; }
}

function fmtMetrics(m) {
  const parts = [];
  if (m.views) parts.push(`${m.views.toLocaleString()} views`);
  if (m.likes) parts.push(`${m.likes.toLocaleString()} likes`);
  if (m.retweets) parts.push(`${m.retweets.toLocaleString()} RTs`);
  if (m.replies) parts.push(`${m.replies.toLocaleString()} replies`);
  if (m.bookmarks) parts.push(`${m.bookmarks.toLocaleString()} bookmarks`);
  return parts.join(' | ');
}

function cleanArticleText(raw) {
  let text = raw;
  text = text.replace(/^.*?Follow\s*\n+\d+\s*\n+\d+\s*\n+[\d.]+K?\s*\n+[\d.]+[KM]?\s*\n+/s, '');
  return text.trim();
}

// Generate overview markdown
let md = `---
title: "X Profile Analysis — @${handle}"
source: "https://x.com/${handle}"
date: "${new Date().toISOString().split('T')[0]}"
status: draft
tags:
  - "#x-research"
  - "#${handle}"
---

## Overview

**Total tweets scraped:** ${tweets.length}${since ? ` (since ${since})` : ''}
**High-value posts:** ${standalonePosts.length} standalone + ${sortedThreads.length} threads + ${articlePosts.length} articles
**Filters:** ${minLikes}+ likes OR ${minViews.toLocaleString()}+ views OR threads with 3+ posts

---

## Top Articles

`;

for (const { tweet, articles } of articlePosts.slice(0, 30)) {
  const article = articles[0];
  const preview = cleanArticleText(article.content).slice(0, 200).replace(/\n/g, ' ');
  md += `### ${fmtDate(tweet.created_at)} — Article\n`;
  md += `${fmtMetrics(tweet.metrics)}\n`;
  md += `https://x.com/${handle}/status/${tweet.id}\n\n`;
  md += `> ${preview}...\n\n`;
  md += `Full article: [[${handle}-article-${article.article_id}]]\n\n`;
  md += `---\n\n`;
}

md += `## Top Threads\n\n`;

for (const thread of sortedThreads) {
  const first = thread.tweets[0];
  const preview = first.text.slice(0, 150).replace(/\n/g, ' ');
  md += `### Thread: ${preview}...\n`;
  md += `**Date:** ${fmtDate(first.created_at)} | **Posts:** ${thread.tweets.length} | **Total likes:** ${thread.totalLikes.toLocaleString()}\n`;
  md += `**Link:** https://x.com/${handle}/status/${first.id}\n\n`;
  md += `> ${first.text.split('\n').join('\n> ')}\n\n`;
  md += `---\n\n`;
}

md += `## Top Standalone Posts\n\n`;

for (const tweet of standalonePosts.slice(0, 50)) {
  md += `### ${fmtDate(tweet.created_at)}\n`;
  md += `${fmtMetrics(tweet.metrics)}\n`;
  md += `https://x.com/${handle}/status/${tweet.id}\n\n`;
  md += `> ${tweet.text.split('\n').join('\n> ')}\n\n`;
  if (tweet.urls.length) md += `Links: ${tweet.urls.join(', ')}\n\n`;
  md += `---\n\n`;
}

// Write overview
const overviewPath = join(outputDir, `${handle}-top-posts.md`);
writeFileSync(overviewPath, md);
console.log(`\nOverview saved: ${overviewPath}`);

// Write individual article files
let articleCount = 0;
for (const { tweet, articles } of articlePosts) {
  for (const article of articles) {
    const cleaned = cleanArticleText(article.content);
    if (cleaned.length < 100) continue;

    const date = fmtDate(tweet.created_at);
    const articleMd = `---
title: "Article by @${handle}: ${cleaned.slice(0, 80).replace(/\n/g, ' ').replace(/"/g, "'")}"
author: "@${handle}"
source: "https://x.com/${handle}/status/${tweet.id}"
date: "${date}"
status: draft
tags:
  - "#x-research"
  - "#${handle}"
---

${cleaned}

---
**Metrics:** ${fmtMetrics(tweet.metrics)}
**Link:** https://x.com/${handle}/status/${tweet.id}
`;

    writeFileSync(join(outputDir, `${handle}-article-${article.article_id}.md`), articleMd);
    articleCount++;
  }
}
console.log(`${articleCount} article files saved to ${outputDir}/`);

// Write individual thread files
let threadCount = 0;
for (const thread of sortedThreads) {
  const first = thread.tweets[0];
  const slug = first.text.slice(0, 50).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  const date = fmtDate(first.created_at);

  let threadMd = `---
title: "Thread by @${handle}: ${first.text.slice(0, 80).replace(/\n/g, ' ').replace(/"/g, "'")}"
author: "@${handle}"
source: "https://x.com/${handle}/status/${first.id}"
date: "${date}"
status: draft
tags:
  - "#x-research"
  - "#${handle}"
---

`;

  for (const tweet of thread.tweets) {
    threadMd += `${tweet.text}\n\n`;
    if (tweet.media.length) {
      tweet.media.forEach(m => { threadMd += `![${m.type}](${m.url})\n`; });
      threadMd += '\n';
    }
  }

  threadMd += `---\n**Metrics:** ${fmtMetrics(first.metrics)}\n`;

  writeFileSync(join(outputDir, `${date}-${handle}-${slug}.md`), threadMd);
  threadCount++;
}

console.log(`${threadCount} thread files saved to ${outputDir}/`);
console.log(`\nDone! Review ${overviewPath} for the highlights.`);
