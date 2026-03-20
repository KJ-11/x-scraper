import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { loadAuth } from '../lib/auth.js';
import { buildHeaders } from '../lib/api.js';
import { fetchTweetDetail, parseTweetDetailResponse } from '../lib/twitter.js';

const DATA_DIR = './data/urls';
mkdirSync(DATA_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));
const skipArticles = args.includes('--no-articles');
const saveFile = args.includes('--save');
const jsonOutput = args.includes('--json');

if (!url) {
  console.log('Usage: x-scraper fetch <tweet-url> [--no-articles] [--save] [--json]');
  console.log('');
  console.log('Options:');
  console.log('  --no-articles  Skip fetching linked X articles via Safari');
  console.log('  --save         Save output to data/urls/');
  console.log('  --json         Output raw JSON instead of markdown');
  process.exit(1);
}

const tweetIdMatch = url.match(/status\/(\d+)/);
if (!tweetIdMatch) {
  console.error('Could not extract tweet ID from URL. Expected: https://x.com/user/status/123');
  process.exit(1);
}
const tweetId = tweetIdMatch[1];

const auth = loadAuth();
const headers = buildHeaders(auth, url);

// Fetch an X article via Safari
function fetchArticle(articleUrl, delayMs = 12) {
  const script = `
tell application "Safari"
  activate
  set newDoc to make new document
  set URL of document 1 to "${articleUrl}"
  delay ${delayMs}

  set currentURL to URL of current tab of window 1
  if currentURL does not contain "article" and currentURL does not contain "x.com" then
    close window 1
    return "ERROR:WRONG_PAGE"
  end if

  set pageContent to do JavaScript "
    (function() {
      var article = document.querySelector('article[role=\\"article\\"]')
        || document.querySelector('article')
        || document.querySelector('[data-testid=\\"tweetText\\"]');
      if (article && article.innerText.length > 100) return article.innerText;
      var main = document.querySelector('main') || document.body;
      return main.innerText;
    })()
  " in current tab of window 1

  close window 1
  return pageContent
end tell
  `;

  try {
    const content = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: (delayMs + 20) * 1000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 5,
    }).trim();

    if (content === 'ERROR:WRONG_PAGE') {
      process.stderr.write(`  Article fetch: landed on wrong page, skipping\n`);
      return null;
    }

    if (content.length < 100) return null;

    let text = content;
    text = text.replace(/^To view keyboard shortcuts.*?\n/i, '');
    text = text.replace(/^View keyboard shortcuts\s*\n*/i, '');
    text = text.replace(/Want to publish your own Article\?.*$/s, '');
    text = text.replace(/Upgrade to Premium.*$/s, '');
    return text.trim();
  } catch (e) {
    process.stderr.write(`Article fetch error: ${e.message.slice(0, 100)}\n`);
    return null;
  }
}

function toMarkdown(focal, thread, replies, articles) {
  const fmtMetrics = (m) => {
    const parts = [];
    if (m.views) parts.push(`${m.views.toLocaleString()} views`);
    if (m.likes) parts.push(`${m.likes.toLocaleString()} likes`);
    if (m.retweets) parts.push(`${m.retweets.toLocaleString()} RTs`);
    if (m.replies) parts.push(`${m.replies.toLocaleString()} replies`);
    if (m.bookmarks) parts.push(`${m.bookmarks.toLocaleString()} bookmarks`);
    return parts.join(' | ');
  };

  const isThread = thread.length > 1;
  let md = '';

  md += `**@${focal.author.handle}** (${focal.author.name}) — ${focal.author.followers.toLocaleString()} followers\n`;
  md += `**Date:** ${focal.created_at}\n`;
  md += `**Link:** ${url}\n`;
  md += `**Metrics:** ${fmtMetrics(focal.metrics)}\n\n`;

  if (isThread) {
    md += `## Thread (${thread.length} posts)\n\n`;
    for (let i = 0; i < thread.length; i++) {
      const t = thread[i];
      md += `**[${i + 1}/${thread.length}]**\n${t.text}\n\n`;
      for (const m of t.media) {
        md += `![${m.type}](${m.url})\n`;
      }
      for (const u of t.urls.filter(u => !u.includes('x.com/') && !u.includes('twitter.com/'))) {
        md += `Link: ${u}\n`;
      }
      if (t.quoted_tweet) {
        md += `> **QT @${t.quoted_tweet.author.handle}:** ${t.quoted_tweet.text.slice(0, 200)}\n`;
      }
      md += '\n';
    }
  } else {
    md += `## Post\n\n${focal.text}\n\n`;
    for (const m of focal.media) {
      md += `![${m.type}](${m.url})\n`;
    }
    for (const u of focal.urls.filter(u => !u.includes('x.com/') && !u.includes('twitter.com/'))) {
      md += `Link: ${u}\n`;
    }
    if (focal.quoted_tweet) {
      md += `\n> **QT @${focal.quoted_tweet.author.handle}:** ${focal.quoted_tweet.text}\n`;
    }
    md += '\n';
  }

  if (articles.length) {
    md += `## Articles\n\n`;
    for (const { articleUrl, content } of articles) {
      md += `**Source:** ${articleUrl}\n\n`;
      md += `${content}\n\n`;
      md += `---\n\n`;
    }
  }

  if (replies.length) {
    const topReplies = replies.slice(0, 5);
    md += `## Top Replies\n\n`;
    for (const r of topReplies) {
      md += `**@${r.author.handle}** (${r.metrics.likes} likes):\n> ${r.text.split('\n').join('\n> ')}\n\n`;
    }
  }

  return md;
}

// Main
process.stderr.write(`Fetching tweet ${tweetId}...\n`);

const json = await fetchTweetDetail(tweetId, headers);
const { focal, thread, replies } = parseTweetDetailResponse(json, tweetId);

if (!focal) {
  console.error('Could not find tweet. It may be deleted, protected, or the API response format changed.');
  process.exit(1);
}

process.stderr.write(`Found: @${focal.author.handle} — ${thread.length > 1 ? `thread (${thread.length} posts)` : 'single post'}\n`);

// Fetch any linked articles
const articles = [];
if (!skipArticles) {
  const allArticleUrls = new Set();
  for (const t of thread) {
    for (const u of t.urls) {
      if (u.includes('/i/article/')) {
        allArticleUrls.add(u);
      }
    }
  }

  if (allArticleUrls.size) {
    process.stderr.write(`Fetching ${allArticleUrls.size} article(s) via Safari...\n`);
    for (const articleUrl of allArticleUrls) {
      const content = fetchArticle(articleUrl);
      if (content) {
        articles.push({ articleUrl, content });
        process.stderr.write(`  Article fetched (${content.length} chars)\n`);
      }
    }
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ focal, thread, replies, articles }, null, 2));
} else {
  console.log(toMarkdown(focal, thread, replies, articles));
}

if (saveFile) {
  const output = { focal, thread, replies, articles, fetched_at: new Date().toISOString(), source_url: url };
  const outPath = `${DATA_DIR}/${tweetId}.json`;
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  process.stderr.write(`Saved to ${outPath}\n`);
}
