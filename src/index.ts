#!/usr/bin/env node

import { Connection } from '@solana/web3.js';
import { SolanaMonitor } from './monitor';
import { TUI } from './tui';
import { loadConfig, findAutoConfig, printConfigTemplate, isConfigFile, WalletEntry } from './config';
import { showWalletSelector } from './selector';

function printUsage() {
  console.log(`
Solana Wallet Monitor — Real-time transaction monitor for Solana wallets

Usage:
  solana-wallet-monitor <wallet-addresses>   Direct wallet addresses
  solana-wallet-monitor <config.json>         Load from config file
  solana-wallet-monitor                       Auto-detect config or show picker

Arguments:
  wallet-addresses   Comma-separated Solana wallet addresses
  config.json        JSON config file with nickname/address pairs
  [rpc-url]          Solana RPC URL (optional, defaults to mainnet-beta)

Examples:
  node dist/index.js GpM5bRq7eSMN...
  node dist/index.js addr1,addr2,addr3
  node dist/index.js wallets.json
  node dist/index.js wallets.json https://api.mainnet-beta.solana.com
  node dist/index.js

Press q to quit.
`);
}

function parseAddresses(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= 32);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let walletEntries: WalletEntry[];
  let rpcUrl = 'https://api.mainnet-beta.solana.com';

  if (args.length === 0) {
    const auto = findAutoConfig();
    if (auto && auto.wallets.length > 0) {
      walletEntries = auto.wallets;
    } else {
      printConfigTemplate();
      process.exit(1);
    }
  } else if (isConfigFile(args[0])) {
    const configPath = args[0];
    const config = loadConfig(configPath);
    walletEntries = config.wallets;
    rpcUrl = args[1] || 'https://api.mainnet-beta.solana.com';
  } else {
    const addresses = parseAddresses(args[0]);
    if (addresses.length === 0) {
      console.error('Error: No valid wallet addresses found');
      process.exit(1);
    }
    walletEntries = addresses.map((addr, i) => ({
      nickname: `wallet${i + 1}`,
      address: addr,
    }));
    rpcUrl = args[1] || 'https://api.mainnet-beta.solana.com';
  }

  const selected = await showWalletSelector(walletEntries);

  if (selected.length === 0) {
    console.log('No wallets selected. Exiting.');
    process.exit(0);
  }

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
  });

  const tui = new TUI(selected.map((w) => w.address), selected);
  const monitors: SolanaMonitor[] = [];

  for (const entry of selected) {
    const monitor = new SolanaMonitor(connection, entry.address);
    monitors.push(monitor);

    monitor.onStatusChange((status, message) => {
      tui.updateStatus(status, message ? `${entry.nickname}: ${message}` : undefined);
    });

    monitor.onTx((event) => {
      tui.onTx(event);
    });

    monitor.start().catch((err: any) => {
      tui.updateStatus('error', `${entry.nickname}: ${err.message}`);
      tui.onError(`${entry.nickname}: ${err.message}`);
    });
  }

  process.on('SIGINT', async () => {
    await Promise.all(monitors.map((m) => m.stop()));
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await Promise.all(monitors.map((m) => m.stop()));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
