import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { loadAuth } from '../lib/auth.js';
import { buildHeaders } from '../lib/api.js';
import { getUserId, fetchUserTweets, parseTimelinePage } from '../lib/twitter.js';

const DATA_DIR = './data';
mkdirSync(DATA_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const handle = (args.find(a => !a.startsWith('--')) || '').replace(/^@/, '');
const maxTweets = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '200');
const sinceArg = args.find(a => a.startsWith('--since='))?.split('=')[1];
const defaultSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const sinceDate = new Date(sinceArg || defaultSince);

if (!handle) {
  console.log('Usage: x-scraper scrape <handle> [--max=200] [--since=YYYY-MM-DD]');
  console.log('');
  console.log('Options:');
  console.log('  --max=N             Maximum tweets to fetch (default: 200)');
  console.log('  --since=YYYY-MM-DD  Only fetch tweets after this date (default: 14 days ago)');
  process.exit(1);
}

const auth = loadAuth();
const headers = buildHeaders(auth, `https://x.com/${handle}`);

const effectiveSince = sinceArg || defaultSince;
console.log(`Scraping @${handle} (max: ${maxTweets}, since: ${effectiveSince})...\n`);

const userId = await getUserId(handle, headers);
console.log(`User ID: ${userId}`);

const seenIds = new Set();
let allTweets = [];
let cursor = null;
let pageNum = 0;
let rateLimited = false;

// Load existing data for resume
const today = new Date().toISOString().split('T')[0];
const outFile = `${DATA_DIR}/${handle}-${today}.json`;

if (existsSync(outFile)) {
  const existing = JSON.parse(readFileSync(outFile, 'utf-8'));
  existing.forEach(t => { seenIds.add(t.id); allTweets.push(t); });
  console.log(`Resuming: ${allTweets.length} tweets already collected.`);
}

while (allTweets.length < maxTweets) {
  pageNum++;
  const json = await fetchUserTweets(userId, headers, cursor);
  if (!json) { rateLimited = true; break; }
  const { tweets, nextCursor } = parseTimelinePage(json);

  let newCount = 0;
  let hitDateCutoff = false;
  for (const tweet of tweets) {
    if (!seenIds.has(tweet.id)) {
      if (sinceDate && new Date(tweet.created_at) < sinceDate) {
        hitDateCutoff = true;
        continue;
      }
      seenIds.add(tweet.id);
      allTweets.push(tweet);
      newCount++;
    }
  }

  process.stdout.write(`\r  Page ${pageNum}: ${newCount} new tweets (${allTweets.length} total)`);

  if (hitDateCutoff) {
    console.log(`\nReached --since cutoff (${effectiveSince}).`);
    break;
  }

  if (!nextCursor || newCount === 0) {
    console.log('\nTimeline exhausted.');
    break;
  }

  cursor = nextCursor;

  // Polite delay to avoid rate limits
  const delay = 5000 + Math.random() * 3000;
  await new Promise(r => setTimeout(r, delay));
}

// Post-process: detect threads
const threadMap = new Map();
for (const tweet of allTweets) {
  if (tweet.conversation_id) {
    if (!threadMap.has(tweet.conversation_id)) threadMap.set(tweet.conversation_id, []);
    threadMap.get(tweet.conversation_id).push(tweet);
  }
}

for (const [convId, threadTweets] of threadMap) {
  if (threadTweets.length > 1) {
    threadTweets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    threadTweets.forEach((t, i) => {
      t.is_thread = true;
      t.thread_id = convId;
      t.thread_position = i + 1;
      t.thread_length = threadTweets.length;
    });
  } else {
    threadTweets[0].is_thread = false;
  }
}

allTweets.forEach(t => { if (t.is_thread === undefined) t.is_thread = false; });

writeFileSync(outFile, JSON.stringify(allTweets, null, 2));
console.log(`\nDone! ${allTweets.length} tweets saved to ${outFile}`);

if (rateLimited) process.exit(2);
