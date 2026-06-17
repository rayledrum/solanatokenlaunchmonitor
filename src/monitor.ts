import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from '@solana/web3.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const KNOWN_LAUNCHPADS = [
  { id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'pump.fun' },
  { id: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', name: 'Moonshot' },
] as const;

export interface NewCoinEvent {
  timestamp: Date;
  txSignature: string;
  mintAddress: string;
  tokenProgram: string;
  slot: number;
  platform?: string;
  wallet: string;
}

export type MonitorStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

export class SolanaMonitor {
  private connection: Connection;
  private wallet: PublicKey;
  private subscriptionId: number | null = null;
  private running = false;

  private onCoinCreatedCb: ((event: NewCoinEvent) => void) | null = null;
  private onStatusChangeCb: ((status: MonitorStatus, message?: string) => void) | null = null;
  private onTxProcessedCb: ((sig: string) => void) | null = null;

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

  onCoinCreated(cb: (event: NewCoinEvent) => void): void {
    this.onCoinCreatedCb = cb;
  }

  onStatusChange(cb: (status: MonitorStatus, message?: string) => void): void {
    this.onStatusChangeCb = cb;
  }

  onTxProcessed(cb: (sig: string) => void): void {
    this.onTxProcessedCb = cb;
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

        this.onTxProcessedCb?.(logs.signature);

        const logsStr = logs.logs.join(' ');

        const isTokenCreate =
          logsStr.includes('InitializeMint') ||
          logsStr.includes('initialize_mint') ||
          logsStr.includes('initialize2') ||
          this.detectLaunchpadCreate(logs.logs);

        if (isTokenCreate) {
          try {
            await this.handleNewMint(logs.signature, context.slot, logs.logs);
          } catch {
            // retry on next matching log
          }
        }
      },
      'confirmed'
    );

    this.emitStatus('connected');
  }

  private detectLaunchpadCreate(logs: string[]): boolean {
    let inLaunchpad = false;

    for (const line of logs) {
      for (const lp of KNOWN_LAUNCHPADS) {
        if (line.includes(lp.id) && line.includes('invoke')) {
          inLaunchpad = true;
          break;
        }
      }
      if (inLaunchpad) break;
    }

    if (!inLaunchpad) return false;

    const createKeywords = ['create', 'tokenMint', 'launch', 'deploy'];
    const combined = logs.join(' ').toLowerCase();

    return createKeywords.some((kw) => combined.includes(kw));
  }

  private detectPlatform(logs: string[]): string | undefined {
    for (const line of logs) {
      for (const lp of KNOWN_LAUNCHPADS) {
        if (line.includes(lp.id)) {
          return lp.name;
        }
      }
    }
    return undefined;
  }

  private async handleNewMint(
    sig: string,
    slot: number,
    logs: string[]
  ): Promise<void> {
    const tx = await this.connection.getTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return;

    const mintAddress = this.extractMintAddress(tx);
    if (!mintAddress) return;

    const tokenProgram = this.detectTokenProgram(tx);
    const platform = this.detectPlatform(logs);

    const event: NewCoinEvent = {
      timestamp: new Date(),
      txSignature: sig,
      mintAddress,
      tokenProgram,
      slot,
      platform,
      wallet: this.wallet.toBase58(),
    };

    this.onCoinCreatedCb?.(event);
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
