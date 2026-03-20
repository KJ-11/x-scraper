import { createInterface } from 'readline';
import { saveAuth } from '../lib/auth.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

console.log(`
=== X/Twitter Cookie Setup ===

1. Open Safari and go to x.com (make sure you're logged in)
2. Safari menu > Settings > Advanced > check "Show features for web developers"
3. Develop menu > Show Web Inspector > Storage tab > Cookies > x.com

You need two cookie values:
`);

const authToken = await ask('Paste auth_token value: ');
const ct0 = await ask('Paste ct0 value: ');

if (!authToken.trim() || !ct0.trim()) {
  console.log('Both values are required.');
  process.exit(1);
}

const savedPath = saveAuth({
  auth_token: authToken.trim(),
  ct0: ct0.trim(),
});

console.log(`\nSaved to ${savedPath}`);
console.log('Now run: x-scraper scrape <handle>');

rl.close();
