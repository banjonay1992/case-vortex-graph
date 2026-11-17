import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseDotenvContent = (content: string) => {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const exportLine = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = exportLine.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = exportLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;
    const value = exportLine.slice(separatorIndex + 1);
    process.env[key] = stripWrappingQuotes(value);
  }
};

export const loadEnv = (options: { quiet?: boolean } = { quiet: true }) => {
  if (loaded) return;
  const envPaths = [
    '.env',
    '.env.local',
  ].map((relativePath) => path.resolve(process.cwd(), relativePath));

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      parseDotenvContent(content);
    } catch (error) {
      if (!options.quiet) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[env] failed to load ${path.relative(process.cwd(), envPath)}: ${message}`);
      }
    }
  }
  loaded = true;
};

export const requireEnv = (name: string) => {
  loadEnv();
  const v = process.env[name];
  if (v == null || String(v).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
};

export const getDatabaseUrl = () => requireEnv('DATABASE_URL');
