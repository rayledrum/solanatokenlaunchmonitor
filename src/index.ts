#!/usr/bin/env node

import { Connection } from '@solana/web3.js';
import { SolanaMonitor } from './monitor';
import { TUI } from './tui';

function printUsage() {
  console.log(`
Solana Wallet Monitor — Real-time new coin creation detection

Usage:
  solana-wallet-monitor <wallet-addresses> [rpc-url]

Arguments:
  wallet-addresses   Comma-separated Solana wallet addresses (required)
  rpc-url            Solana RPC URL (optional, defaults to mainnet-beta)

Examples:
  solana-wallet-monitor GpM5bRq7eSMNCPeM6QbY6oFq2JqPqJqPqJqPqJqPqJqP
  solana-wallet-monitor addr1,addr2,addr3
  solana-wallet-monitor addr1,addr2 https://api.mainnet-beta.solana.com

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

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const walletAddresses = parseAddresses(args[0]);
  const rpcUrl = args[1] || 'https://api.mainnet-beta.solana.com';

  if (walletAddresses.length === 0) {
    console.error('Error: No valid wallet addresses provided');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
  });

  const tui = new TUI(walletAddresses);
  const monitors: SolanaMonitor[] = [];

  for (const addr of walletAddresses) {
    const monitor = new SolanaMonitor(connection, addr);
    monitors.push(monitor);

    monitor.onStatusChange((status, message) => {
      tui.updateStatus(status, message ? `${addr.slice(0, 8)}: ${message}` : undefined);
    });

    monitor.onTx((event) => {
      tui.onTx(event);
    });

    monitor.start().catch((err: any) => {
      tui.updateStatus('error', `${addr.slice(0, 8)}: ${err.message}`);
      tui.onError(`${addr.slice(0, 8)}: ${err.message}`);
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
