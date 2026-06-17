import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from '@solana/web3.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const KNOWN_LAUNCHPADS = [
  { id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'pump.fun' },
  { id: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', name: 'Moonshot' },
] as const;

const DEX_PROGRAMS = [
  'JUP6LkbZbjS1jKKwapdHX74xkaf3AxC2Dkrm3bEnrM',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7gr6K8LqFD',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  '9W959DqEETi9e4in1q9W7bq8o9fH1g8gjP1JjZLgHnbd',
];

export type TxType = 'create' | 'buy' | 'sell' | 'transfer' | 'unknown';

export interface TxEvent {
  type: TxType;
  timestamp: Date;
  txSignature: string;
  slot: number;
  wallet: string;
  mintAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenProgram?: string;
  platform?: string;
  details?: string;
}

export type MonitorStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

function programIdInLogs(logs: string[], id: string): boolean {
  return logs.some((l) => l.includes(id) && l.includes('invoke'));
}

function detectPlatformInLogs(logs: string[]): string | undefined {
  for (const line of logs) {
    for (const lp of KNOWN_LAUNCHPADS) {
      if (line.includes(lp.id)) return lp.name;
    }
  }
  return undefined;
}

function classifyTxType(logs: string[]): { type: TxType; platform?: string } {
  const joined = logs.join(' ');
  const lower = joined.toLowerCase();

  // 1. Token creation — always a create regardless of platform
  if (lower.includes('initializemint') || lower.includes('initialize_mint') || lower.includes('initialize2')) {
    const platform = detectPlatformInLogs(logs);
    return { type: 'create', platform };
  }

  // 2. Check known launchpad programs — buy/sell/create from pump.fun / Moonshot
  for (const lp of KNOWN_LAUNCHPADS) {
    if (!programIdInLogs(logs, lp.id)) continue;

    if (lower.includes('instruction: buy') || lower.includes('program log: buy')) {
      return { type: 'buy', platform: lp.name };
    }
    if (lower.includes('instruction: sell') || lower.includes('program log: sell')) {
      return { type: 'sell', platform: lp.name };
    }
    if (lower.includes('create') || lower.includes('tokenmint')) {
      const hasInitMint = lower.includes('initializemint') || lower.includes('initialize_mint');
      return { type: hasInitMint ? 'create' : 'unknown', platform: lp.name };
    }
    // Launchpad involved but can't determine direction — don't fall through to transfer
    return { type: 'unknown', platform: lp.name };
  }

  // 3. DEX swap (Jupiter, Raydium, etc.) — not a plain transfer, mark unknown
  for (const dex of DEX_PROGRAMS) {
    if (programIdInLogs(logs, dex)) {
      return { type: 'unknown' };
    }
  }

  // 4. Plain Token or SOL transfer (no DEX/launchpad involved)
  if (joined.includes('Instruction: Transfer') || joined.includes('Instruction: TransferChecked')) {
    return { type: 'transfer' };
  }

  if (joined.includes(SYSTEM_PROGRAM_ID) && joined.includes('Instruction: Transfer')) {
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
        } else if (type === 'unknown') {
          const filled = await this.enrichUnknownEvent(baseEvent).catch(() => baseEvent);
          this.onTxCb?.(filled);
        } else {
          this.onTxCb?.(baseEvent);
        }
      },
      'confirmed'
    );

    this.emitStatus('connected');
  }

  private async fetchTokenMetadata(
    mintAddress: string
  ): Promise<{ name: string; symbol: string } | null> {
    try {
      const mint = new PublicKey(mintAddress);
      const metadataPda = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), new PublicKey(METADATA_PROGRAM_ID).toBuffer(), mint.toBuffer()],
        new PublicKey(METADATA_PROGRAM_ID)
      )[0];

      const accountInfo = await this.connection.getAccountInfo(metadataPda);
      if (!accountInfo || !accountInfo.data) return null;

      const data = accountInfo.data;
      let offset = 1 + 32 + 32;

      function readString(): string {
        const len = data.readUInt32LE(offset);
        offset += 4;
        const str = data.subarray(offset, offset + len).toString('utf8');
        offset += len;
        return str;
      }

      const name = readString();
      const symbol = readString();
      return { name: name.replace(/\0/g, '').trim(), symbol: symbol.replace(/\0/g, '').trim() };
    } catch {
      return null;
    }
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

    if (!mintAddress) return base;

    const meta = await this.fetchTokenMetadata(mintAddress);
    const symbolStr = meta ? `${meta.symbol}` : '';
    const nameStr = meta ? `${meta.name}` : '';

    return {
      ...base,
      mintAddress,
      tokenName: meta?.name,
      tokenSymbol: meta?.symbol,
      tokenProgram: this.detectTokenProgram(tx),
      details: meta ? `${meta.symbol}` : mintAddress.slice(0, 8) + '...',
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

  private async enrichUnknownEvent(base: TxEvent): Promise<TxEvent> {
    const tx = await this.connection.getTransaction(base.txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return base;
    return this.classifyFromBalances(base, tx);
  }

  private classifyFromBalances(base: TxEvent, tx: VersionedTransactionResponse): TxEvent {
    const meta = tx.meta;
    if (!meta) return base;

    const walletStr = this.wallet.toBase58();
    const msg = tx.transaction.message;
    const accountKeys = msg.getAccountKeys();
    const SOL_THRESHOLD = 0.0001;

    let walletIdx = -1;
    for (let i = 0; i < accountKeys.staticAccountKeys.length; i++) {
      if (accountKeys.staticAccountKeys[i].toBase58() === walletStr) {
        walletIdx = i;
        break;
      }
    }
    if (walletIdx === -1) return base;

    const preSol = meta.preBalances[walletIdx] / 1e9;
    const postSol = meta.postBalances[walletIdx] / 1e9;
    const solChange = postSol - preSol;

    type TokenDelta = { mint: string; pre: number; post: number };
    const tokenDeltas: TokenDelta[] = [];
    const preByAcct: Map<number, { mint: string; amount: number }> = new Map();

    for (const tb of meta.preTokenBalances || []) {
      if (tb.owner === walletStr) {
        preByAcct.set(tb.accountIndex, { mint: tb.mint, amount: tb.uiTokenAmount.uiAmount ?? 0 });
      }
    }

    for (const tb of meta.postTokenBalances || []) {
      if (tb.owner !== walletStr) continue;
      const pre = preByAcct.get(tb.accountIndex);
      const preAmt = pre ? pre.amount : 0;
      const postAmt = tb.uiTokenAmount.uiAmount ?? 0;
      if (postAmt !== preAmt) {
        tokenDeltas.push({ mint: tb.mint, pre: preAmt, post: postAmt });
      }
      preByAcct.delete(tb.accountIndex);
    }

    for (const [_, pre] of preByAcct) {
      tokenDeltas.push({ mint: pre.mint, pre: pre.amount, post: 0 });
    }

    const realDeltas = tokenDeltas.filter((d) => d.mint !== WSOL_MINT);
    const netTokenDelta = realDeltas.reduce((s, d) => s + (d.post - d.pre), 0);

    if (solChange < -SOL_THRESHOLD && netTokenDelta > 0) {
      const mint = realDeltas.find((d) => d.post > d.pre)?.mint;
      return { ...base, type: 'buy', mintAddress: mint };
    }
    if (solChange > SOL_THRESHOLD && netTokenDelta < 0) {
      const mint = realDeltas.find((d) => d.post < d.pre)?.mint;
      return { ...base, type: 'sell', mintAddress: mint };
    }
    if (realDeltas.length > 0 || Math.abs(solChange) > SOL_THRESHOLD) {
      return { ...base, type: 'transfer' };
    }

    return base;
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
