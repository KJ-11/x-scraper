import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_AUTH_PATH = join(homedir(), '.x-scraper', 'auth.json');

function getAuthPath() {
  return process.env.X_SCRAPER_AUTH || DEFAULT_AUTH_PATH;
}

export function loadAuth() {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) {
    console.error(`No auth found at ${authPath}. Run \`x-scraper login\` first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(authPath, 'utf-8'));
}

export function saveAuth(tokens) {
  const authPath = getAuthPath();
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, JSON.stringify(tokens, null, 2));
  return authPath;
}
