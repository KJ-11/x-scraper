import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const DATA_DIR = './data';
const ARTICLES_DIR = './data/articles';
mkdirSync(ARTICLES_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const handle = (args.find(a => !a.startsWith('--')) || '').replace(/^@/, '');
const delayMs = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '10');

if (!handle) {
  console.log('Usage: x-scraper articles <handle> [--delay=10]');
  console.log('');
  console.log('Fetches X articles linked in previously scraped tweets using Safari.');
  console.log('Requires macOS with Safari.');
  console.log('');
  console.log('Options:');
  console.log('  --delay=N  Seconds to wait for article page to load (default: 10)');
  process.exit(1);
}

// Find most recent data file
const files = readdirSync(DATA_DIR)
  .filter(f => f.startsWith(handle) && f.endsWith('.json'))
  .sort()
  .reverse();

if (!files.length) {
  console.log(`No data found for @${handle}. Run \`x-scraper scrape ${handle}\` first.`);
  process.exit(1);
}

const tweets = JSON.parse(readFileSync(join(DATA_DIR, files[0]), 'utf-8'));

// Find all article URLs
const articleTweets = [];
for (const tweet of tweets) {
  for (const url of tweet.urls) {
    if (url.includes('/i/article/') || url.includes('x.com/i/article')) {
      const articleId = url.match(/article\/(\d+)/)?.[1];
      if (articleId) {
        articleTweets.push({ tweetId: tweet.id, articleId, url, tweet });
      }
    }
  }
}

console.log(`Found ${articleTweets.length} articles in @${handle}'s tweets\n`);

const toFetch = articleTweets.filter(a => !existsSync(`${ARTICLES_DIR}/${a.articleId}.json`));
console.log(`${articleTweets.length - toFetch.length} already fetched, ${toFetch.length} to fetch\n`);

function cleanArticleContent(raw) {
  let text = raw;
  text = text.replace(/^To view keyboard shortcuts.*?\n/i, '');
  text = text.replace(/^View keyboard shortcuts\s*\n*/i, '');
  text = text.replace(/Want to publish your own Article\?.*$/s, '');
  text = text.replace(/Upgrade to Premium.*$/s, '');
  return text.trim();
}

for (let i = 0; i < toFetch.length; i++) {
  const { articleId, url, tweet } = toFetch[i];
  const fullUrl = url.startsWith('http') ? url : `https://x.com/i/article/${articleId}`;

  process.stdout.write(`[${i + 1}/${toFetch.length}] Fetching article ${articleId}...`);

  try {
    const script = `
      tell application "Safari"
        activate
        open location "${fullUrl}"
        delay ${delayMs}
        set pageContent to do JavaScript "document.querySelector('article')?.innerText || document.querySelector('[data-testid=tweetText]')?.innerText || document.body.innerText" in current tab of front window
        return pageContent
      end tell
    `;

    const content = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: (delayMs + 15) * 1000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 5,
    }).trim();

    if (content.length < 100) {
      console.log(` SKIP (too short: ${content.length} chars)`);
      continue;
    }

    const cleaned = cleanArticleContent(content);

    const articleData = {
      article_id: articleId,
      tweet_id: tweet.id,
      author: handle,
      tweet_date: tweet.created_at,
      tweet_metrics: tweet.metrics,
      url: fullUrl,
      content: cleaned,
      fetched_at: new Date().toISOString(),
    };

    writeFileSync(`${ARTICLES_DIR}/${articleId}.json`, JSON.stringify(articleData, null, 2));
    console.log(` OK (${cleaned.length} chars)`);

    if (i < toFetch.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    console.log(` ERROR: ${e.message.slice(0, 100)}`);
  }
}

// Update tweets JSON with article references
const updatedTweets = tweets.map(tweet => {
  const articleUrls = tweet.urls.filter(u => u.includes('/i/article/'));
  if (articleUrls.length) {
    const articleIds = articleUrls.map(u => u.match(/article\/(\d+)/)?.[1]).filter(Boolean);
    tweet.article_ids = articleIds;
    tweet.has_articles = true;
  }
  return tweet;
});

writeFileSync(join(DATA_DIR, files[0]), JSON.stringify(updatedTweets, null, 2));

console.log(`\nDone! Articles saved to ${ARTICLES_DIR}/`);
