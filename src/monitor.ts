import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from '@solana/web3.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const KNOWN_LAUNCHPADS = [
  { id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'pump.fun' },
  { id: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', name: 'Moonshot' },
] as const;

export type TxType = 'create' | 'buy' | 'sell' | 'transfer' | 'unknown';

export interface TxEvent {
  type: TxType;
  timestamp: Date;
  txSignature: string;
  slot: number;
  wallet: string;
  mintAddress?: string;
  tokenProgram?: string;
  platform?: string;
  details?: string;
}

export type MonitorStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

function classifyTxType(logs: string[]): { type: TxType; platform?: string } {
  const joined = logs.join(' ');

  for (const lp of KNOWN_LAUNCHPADS) {
    const inLaunchpad = logs.some((l) => l.includes(lp.id) && l.includes('invoke'));
    if (!inLaunchpad) continue;

    const lowerJoined = joined.toLowerCase();
    if (lowerJoined.includes('initializemint') || lowerJoined.includes('initialize_mint')) {
      return { type: 'create', platform: lp.name };
    }
    if (lowerJoined.includes('instruction: buy') || lowerJoined.includes('"buy"')) {
      return { type: 'buy', platform: lp.name };
    }
    if (lowerJoined.includes('instruction: sell') || lowerJoined.includes('"sell"')) {
      return { type: 'sell', platform: lp.name };
    }
    if (lowerJoined.includes('create') || lowerJoined.includes('tokenmint')) {
      return { type: 'create', platform: lp.name };
    }
  }

  if (joined.includes('InitializeMint') || joined.includes('initialize_mint')) {
    return { type: 'create' };
  }

  if (
    joined.includes('Instruction: Transfer') ||
    joined.includes('Instruction: TransferChecked')
  ) {
    return { type: 'transfer' };
  }

  if (
    joined.includes(SYSTEM_PROGRAM_ID) &&
    (joined.includes('Instruction: Transfer') || joined.includes('Instruction: CreateAccount'))
  ) {
    return { type: 'transfer' };
  }

  return { type: 'unknown' };
}

export class SolanaMonitor {
  private connection: Connection;
  private wallet: PublicKey;
  private subscriptionId: number | null = null;
  private running = false;

  private onTxCb: ((event: TxEvent) => void) | null = null;
  private onStatusChangeCb: ((status: MonitorStatus, message?: string) => void) | null = null;

  constructor(connectionOrUrl: Connection | string, walletAddress: string) {
    if (typeof connectionOrUrl === 'string') {
      this.connection = new Connection(connectionOrUrl, {
        commitment: 'confirmed',
        wsEndpoint: connectionOrUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
      });
    } else {
      this.connection = connectionOrUrl;
    }
    this.wallet = new PublicKey(walletAddress);
  }

  get walletAddress(): string {
    return this.wallet.toBase58();
  }

  onTx(cb: (event: TxEvent) => void): void {
    this.onTxCb = cb;
  }

  onStatusChange(cb: (status: MonitorStatus, message?: string) => void): void {
    this.onStatusChangeCb = cb;
  }

  private emitStatus(status: MonitorStatus, message?: string): void {
    this.onStatusChangeCb?.(status, message);
  }

  async start(): Promise<void> {
    this.running = true;
    this.emitStatus('connecting');

    this.subscriptionId = this.connection.onLogs(
      this.wallet,
      async (logs, context) => {
        if (!this.running) return;

        const { type, platform } = classifyTxType(logs.logs);
        const baseEvent: TxEvent = {
          type,
          timestamp: new Date(),
          txSignature: logs.signature,
          slot: context.slot,
          wallet: this.wallet.toBase58(),
          platform,
        };

        if (type === 'create') {
          try {
            const filled = await this.enrichCreateEvent(baseEvent, logs.logs);
            this.onTxCb?.(filled);
          } catch {
            this.onTxCb?.(baseEvent);
          }
        } else {
          this.onTxCb?.(baseEvent);
        }
      },
      'confirmed'
    );

    this.emitStatus('connected');
  }

  private async enrichCreateEvent(
    base: TxEvent,
    logs: string[]
  ): Promise<TxEvent> {
    const tx = await this.connection.getTransaction(base.txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return base;

    const mintAddress = this.extractMintAddress(tx);

    return {
      ...base,
      mintAddress: mintAddress ?? undefined,
      tokenProgram: mintAddress ? this.detectTokenProgram(tx) : undefined,
      details: mintAddress ? `Token: ${mintAddress.slice(0, 8)}...` : undefined,
    };
  }

  private detectTokenProgram(tx: VersionedTransactionResponse): string {
    const message = tx.transaction.message;
    const accountKeys = message.getAccountKeys();

    for (const ix of message.compiledInstructions) {
      const progId = accountKeys.get(ix.programIdIndex);
      if (!progId) continue;
      const addr = progId.toBase58();
      if (addr === TOKEN_PROGRAM_ID) return TOKEN_PROGRAM_ID;
      if (addr === TOKEN_2022_PROGRAM_ID) return TOKEN_2022_PROGRAM_ID;
    }
    return 'Token';
  }

  private extractMintAddress(tx: VersionedTransactionResponse): string | null {
    const preMints = tx.meta?.preTokenBalances
      ? new Set(tx.meta.preTokenBalances.map((b) => b.mint).filter(Boolean))
      : new Set<string>();

    if (tx.meta?.postTokenBalances) {
      for (const bal of tx.meta.postTokenBalances) {
        if (bal.mint && bal.mint !== WSOL_MINT && !preMints.has(bal.mint)) {
          return bal.mint;
        }
      }
    }

    const candidates: Set<string> = new Set();
    if (tx.meta?.innerInstructions) {
      const accountKeys = tx.transaction.message.getAccountKeys();

      for (const inner of tx.meta.innerInstructions) {
        for (const ix of inner.instructions) {
          const progId = accountKeys.get(ix.programIdIndex);
          if (!progId) continue;
          const progStr = progId.toBase58();

          if (progStr !== TOKEN_PROGRAM_ID && progStr !== TOKEN_2022_PROGRAM_ID) continue;

          const data = Buffer.from(ix.data, 'base64');
          if (data.length > 0 && data[0] === 0) {
            if (ix.accounts.length > 0) {
              const mintAcct = accountKeys.get(ix.accounts[0]);
              if (mintAcct) {
                const mintAddr = mintAcct.toBase58();
                if (!preMints.has(mintAddr)) {
                  candidates.add(mintAddr);
                }
              }
            }
          }
        }
      }
    }

    if (candidates.size === 1) {
      return candidates.values().next().value ?? null;
    }

    if (tx.meta?.preBalances && tx.meta.postBalances) {
      const accountKeys = tx.transaction.message.getAccountKeys();
      const message = tx.transaction.message;
      for (const ix of message.compiledInstructions) {
        const progId = accountKeys.get(ix.programIdIndex);
        if (!progId) continue;
        const progStr = progId.toBase58();
        const isLaunchpad = KNOWN_LAUNCHPADS.some((lp) => lp.id === progStr);
        if (!isLaunchpad) continue;

        for (const acctIdx of ix.accountKeyIndexes) {
          const acct = accountKeys.get(acctIdx);
          if (!acct) continue;
          const addr = acct.toBase58();
          if (addr === this.wallet.toBase58()) continue;
          if (addr === progStr) continue;
          if (preMints.has(addr)) continue;

          const preBal = tx.meta.preBalances[acctIdx] || 0;
          const postBal = tx.meta.postBalances[acctIdx] || 0;
          if (preBal === 0 && postBal >= 2039280) {
            return addr;
          }
        }
      }
    }

    return null;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    this.emitStatus('disconnected');
  }
}
