import fs from 'node:fs';
import { configPath, homeDir } from './paths.js';

function defaultConfig() {
  return { port: 4790 };
}

export function readConfig() {
  fs.mkdirSync(homeDir(), { recursive: true });
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return defaultConfig();
    throw err;
  }
}

export function writeConfig(config) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
