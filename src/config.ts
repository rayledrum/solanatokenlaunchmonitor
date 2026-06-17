import * as fs from 'fs';
import * as path from 'path';

export interface WalletEntry {
  nickname: string;
  address: string;
}

export interface AppConfig {
  wallets: WalletEntry[];
}

const DEFAULT_PATHS = [
  './wallets.json',
  './solana-wallet-monitor.json',
  path.join(process.env.HOME || '~', '.config', 'solana-wallet-monitor', 'wallets.json'),
  path.join(process.env.HOME || '~', '.solanawatch.json'),
];

export function isConfigFile(arg: string): boolean {
  return arg.endsWith('.json') || arg === '--config';
}

export function loadConfig(filePath: string): AppConfig {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return { wallets: parsed };
  }

  if (parsed.wallets && Array.isArray(parsed.wallets)) {
    return parsed as AppConfig;
  }

  throw new Error(
    `Invalid config format in ${filePath}. Expected { "wallets": [{ "nickname": "...", "address": "..." }] }`
  );
}

export function findAutoConfig(): AppConfig | null {
  for (const p of DEFAULT_PATHS) {
    try {
      const resolved = path.resolve(p);
      if (fs.existsSync(resolved)) {
        return loadConfig(resolved);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function printConfigTemplate(): void {
  console.log(`
Create a wallets.json file:

{
  "wallets": [
    { "nickname": "dev1", "address": "GpM5bRq7eSMN..." },
    { "nickname": "dev2", "address": "AbCdEf1234..." }
  ]
}

Then run:
  node dist/index.js wallets.json
`);
}
