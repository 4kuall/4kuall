// Tiny JSON-file persistence. Everything the Oracle knows lives in ./data.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export function load(name, fallback) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

export function save(name, value) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const DEFAULT_PROFILE = {
  name: '',
  about: '',
  values: '',
  goals: '',
  struggles: '',
  // Learned by the Oracle over time from conversations.
  insights: [],
  traits: {},
  lastSummary: '',
};
