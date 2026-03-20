import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'bin', 'cli.js');

// Config
const BATCH_SIZE = 3;
const COOLDOWN_BETWEEN_HANDLES = 60;
const COOLDOWN_BETWEEN_BATCHES = 120;

// Parse CLI args
const args = process.argv.slice(2);
const handlesFile = args.find(a => !a.startsWith('--')) || 'handles.txt';
const skipArticles = args.includes('--skip-articles');
const startFrom = parseInt(args.find(a => a.startsWith('--start='))?.split('=')[1] || '0');
const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1];

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: x-scraper batch [handles-file] [options]');
  console.log('');
  console.log('Process multiple handles from a file (one handle per line).');
  console.log('');
  console.log('Options:');
  console.log('  --skip-articles  Skip fetching X articles via Safari');
  console.log('  --start=N        Start from handle index N (for resuming)');
  console.log('  --output=DIR     Output directory for processed markdown');
  process.exit(0);
}

let handles;
try {
  handles = readFileSync(handlesFile, 'utf-8')
    .split('\n')
    .map(h => h.trim())
    .filter(Boolean);
} catch {
  console.error(`Could not read handles file: ${handlesFile}`);
  console.error('Create a file with one X handle per line, or specify the path.');
  process.exit(1);
}

if (!handles.length) {
  console.log('No handles found in file.');
  process.exit(1);
}

console.log(`Found ${handles.length} handles, processing in batches of ${BATCH_SIZE}`);
if (startFrom > 0) console.log(`Starting from index ${startFrom}`);
console.log('');

const batches = [];
for (let i = startFrom; i < handles.length; i += BATCH_SIZE) {
  batches.push(handles.slice(i, i + BATCH_SIZE));
}

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 300000 });
    return true;
  } catch (e) {
    if (e.status === 2) {
      console.log(`\nRate limited during ${label}`);
      return false;
    }
    if (e.status === 1) {
      console.log(`\n${label} failed (auth or missing data)`);
      return false;
    }
    console.log(`\n${label} error: ${e.message.slice(0, 100)}`);
    return false;
  }
}

function sleep(seconds) {
  console.log(`Cooling down ${seconds}s...`);
  execSync(`sleep ${seconds}`);
}

let rateLimitHit = false;

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const batchNum = b + 1;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH ${batchNum}/${batches.length}: ${batch.join(', ')}`);
  console.log('='.repeat(60));

  for (let h = 0; h < batch.length; h++) {
    const handle = batch[h];
    console.log(`\n--- @${handle} (${h + 1}/${batch.length}) ---\n`);

    console.log('[1/3] Scraping...');
    const scraped = run(`node ${CLI_PATH} scrape ${handle}`, `scrape @${handle}`);
    if (!scraped) {
      rateLimitHit = true;
      console.log('\nStopping batch — rate limit hit during scrape.');
      break;
    }

    if (!skipArticles) {
      console.log('\n[2/3] Fetching articles...');
      run(`node ${CLI_PATH} articles ${handle}`, `articles @${handle}`);
    } else {
      console.log('\n[2/3] Skipping articles (--skip-articles)');
    }

    console.log('\n[3/3] Processing...');
    const processArgs = outputDir ? `${handle} --output=${outputDir}` : handle;
    run(`node ${CLI_PATH} process ${processArgs}`, `process @${handle}`);

    if (h < batch.length - 1) {
      sleep(COOLDOWN_BETWEEN_HANDLES);
    }
  }

  if (rateLimitHit) break;

  if (b < batches.length - 1) {
    console.log(`\nBatch ${batchNum} complete.`);
    sleep(COOLDOWN_BETWEEN_BATCHES);
  }
}

if (rateLimitHit) {
  const completed = batches.slice(0, batches.findIndex(b => b === batches[batches.length - 1])).flat().length;
  console.log(`\nRate limited. Re-run with --start=${completed} to continue.`);
} else {
  console.log(`\nAll ${handles.length} handles processed!`);
}
