import { USER_FEATURES, TWEET_FEATURES } from './api.js';

// Resolve a screen name to a user ID
export async function getUserId(screenName, headers) {
  const variables = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
  const features = JSON.stringify(USER_FEATURES);
  const url = `https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.error('Auth failed — cookies may have expired. Run `x-scraper login` again.');
      process.exit(1);
    }
    throw new Error(`UserByScreenName failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data.user.result.rest_id;
}

// Fetch a page of user tweets
export async function fetchUserTweets(userId, headers, cursor) {
  const variables = {
    userId,
    count: 40,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  };
  if (cursor) variables.cursor = cursor;

  const url = `https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(TWEET_FEATURES))}`;

  const res = await fetch(url, { headers });
  if (res.status === 429) return null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.error('Auth failed — cookies may have expired. Run `x-scraper login` again.');
      process.exit(1);
    }
    throw new Error(`UserTweets failed: ${res.status}`);
  }
  return res.json();
}

// Fetch detailed tweet data with conversation context
export async function fetchTweetDetail(tweetId, headers) {
  const variables = {
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: 'Relevance',
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  };

  const url = `https://x.com/i/api/graphql/nBS-WpgA6ZG0CyNHD517JQ/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(TWEET_FEATURES))}`;

  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') || '90';
    process.stderr.write(`Rate limited — waiting ${retryAfter}s...\n`);
    await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
    return fetchTweetDetail(tweetId, headers);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.error('Auth failed — cookies may have expired. Run `x-scraper login` again.');
      process.exit(1);
    }
    throw new Error(`TweetDetail failed: ${res.status}`);
  }
  return res.json();
}

// Extract structured tweet data from an API result
export function extractTweet(result) {
  if (!result) return null;
  const tweet = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy?.full_text) return null;

  const id = legacy.id_str || tweet.rest_id;
  if (!id) return null;

  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
  const user = tweet.core?.user_results?.result?.legacy || {};

  const media = (legacy.extended_entities?.media || legacy.entities?.media || []).map(m => ({
    type: m.type === 'photo' ? 'photo' : 'video',
    url: m.type === 'photo' ? m.media_url_https : (m.video_info?.variants?.find(v => v.content_type === 'video/mp4')?.url || m.media_url_https),
    alt: m.ext_alt_text || null,
  }));

  const urls = (legacy.entities?.urls || []).map(u => u.expanded_url).filter(Boolean);
  const isRetweet = !!legacy.retweeted_status_result;
  const quotedId = tweet.quoted_status_result?.result?.rest_id || null;

  let quotedTweet = null;
  if (tweet.quoted_status_result?.result) {
    quotedTweet = extractTweet(tweet.quoted_status_result.result);
  }

  return {
    id,
    text: noteText || legacy.full_text,
    created_at: legacy.created_at,
    author: {
      handle: user.screen_name || 'unknown',
      name: user.name || 'Unknown',
      followers: user.followers_count || 0,
    },
    metrics: {
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      views: parseInt(tweet.views?.count) || 0,
      bookmarks: legacy.bookmark_count || 0,
    },
    media,
    urls,
    is_retweet: isRetweet,
    is_quote_tweet: !!quotedId,
    quoted_tweet_id: quotedId,
    quoted_tweet: quotedTweet,
    conversation_id: legacy.conversation_id_str || null,
    in_reply_to: legacy.in_reply_to_status_id_str || null,
    user_id: legacy.user_id_str || null,
  };
}

// Parse UserTweets timeline response
export function parseTimelinePage(json) {
  const tweets = [];
  let nextCursor = null;

  const instructions = json?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];

  for (const instruction of instructions) {
    const entries = instruction.entries || (instruction.entry ? [instruction.entry] : []);

    for (const entry of entries) {
      if (entry.entryId?.startsWith('cursor-bottom')) {
        nextCursor = entry.content?.value;
        continue;
      }

      const itemContent = entry.content?.itemContent;
      if (itemContent?.tweet_results?.result) {
        const tweet = extractTweet(itemContent.tweet_results.result);
        if (tweet && !tweet.is_retweet) tweets.push(tweet);
        continue;
      }

      const items = entry.content?.items;
      if (items) {
        for (const item of items) {
          const ic = item.item?.itemContent;
          if (ic?.tweet_results?.result) {
            const tweet = extractTweet(ic.tweet_results.result);
            if (tweet && !tweet.is_retweet) tweets.push(tweet);
          }
        }
      }
    }
  }

  return { tweets, nextCursor };
}

// Parse TweetDetail response into focal tweet, thread, and replies
export function parseTweetDetailResponse(json, focalId) {
  const entries = [];
  const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];

  for (const instruction of instructions) {
    for (const entry of (instruction.entries || [])) {
      const itemContent = entry.content?.itemContent;
      if (itemContent?.tweet_results?.result) {
        const tweet = extractTweet(itemContent.tweet_results.result);
        if (tweet) entries.push(tweet);
        continue;
      }

      const items = entry.content?.items;
      if (items) {
        for (const item of items) {
          const ic = item.item?.itemContent;
          if (ic?.tweet_results?.result) {
            const tweet = extractTweet(ic.tweet_results.result);
            if (tweet) entries.push(tweet);
          }
        }
      }
    }
  }

  const focal = entries.find(t => t.id === focalId);
  if (!focal) return { focal: null, thread: [], replies: [] };

  const convId = focal.conversation_id;
  const authorHandle = focal.author.handle;

  const thread = entries
    .filter(t => t.conversation_id === convId && t.author.handle === authorHandle)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const replies = entries
    .filter(t => t.conversation_id === convId && t.author.handle !== authorHandle)
    .sort((a, b) => b.metrics.likes - a.metrics.likes);

  return { focal, thread: thread.length > 1 ? thread : [focal], replies };
}
