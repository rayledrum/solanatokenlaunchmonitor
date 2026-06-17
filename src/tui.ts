import * as blessed from 'blessed';
import { NewCoinEvent, MonitorStatus } from './monitor';

const TOKEN_KNOWN_PROGRAMS: Record<string, string> = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token2022',
};

function shorten(addr: string): string {
  return addr.slice(0, 4) + '..' + addr.slice(-4);
}

export class TUI {
  private screen: blessed.Widgets.Screen;
  private titleBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private statsBox: blessed.Widgets.BoxElement;
  private eventCount = 0;
  private txCount = 0;
  private walletCount: number;

  constructor(wallets: string[]) {
    this.walletCount = wallets.length;

    const shortAddrs = wallets.map(shorten).join(', ');
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Solana Wallet Monitor',
      dockBorders: true,
    });

    const label =
      wallets.length === 1
        ? `Watching: {green-fg}${shortAddrs}{/green-fg}`
        : `Watching {green-fg}${wallets.length} wallets{/green-fg}: ${shortAddrs}`;

    this.titleBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ` {bold}Solana Wallet Monitor{/bold}  |  ${label} `,
      tags: true,
      border: { type: 'line' },
      style: { fg: 'white', bg: 'blue', border: { fg: 'blue' } },
    });

    this.statsBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: 3,
      content: ` {bold}Status:{/bold} connecting...  |  Txs: 0  |  New Coins: 0  |  Wallets: ${wallets.length}  |  Press {yellow-fg}q{/yellow-fg} to quit`,
      tags: true,
      style: { fg: 'white', bg: 'black' },
      border: { type: 'line' },
    });

    this.logBox = blessed.log({
      parent: this.screen,
      top: 6,
      left: 0,
      width: '100%',
      height: '100%-9',
      content: '',
      tags: true,
      border: { type: 'line' },
      label: ' Coin Creation Log ',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'white' } },
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } },
    });

    this.screen.key(['q', 'Q', 'C-c'], () => process.exit(0));
    this.screen.render();
  }

  updateStatus(status: MonitorStatus, message?: string): void {
    const colors: Record<MonitorStatus, string> = {
      connecting: '{yellow-fg}',
      connected: '{green-fg}',
      error: '{red-fg}',
      disconnected: '{red-fg}',
    };
    const color = colors[status] || '{white-fg}';
    this.statsBox.setContent(
      ` {bold}Status:{/bold} ${color}${status}{/color}  |  Txs: ${this.txCount}  |  New Coins: ${this.eventCount}  |  Wallets: ${this.walletCount}  |  ${message || ''}  |  Press {yellow-fg}q{/yellow-fg} to quit`
    );
    this.screen.render();
  }

  onTxProcessed(): void {
    this.txCount++;
    this.statsBox.setContent(
      this.statsBox.content.replace(/Txs: \d+/, `Txs: ${this.txCount}`)
    );
    this.screen.render();
  }

  onCoinCreated(event: NewCoinEvent): void {
    this.eventCount++;
    const progName = TOKEN_KNOWN_PROGRAMS[event.tokenProgram] || event.tokenProgram.slice(0, 8) + '...';
    const platform = event.platform ? ` {magenta-fg}[${event.platform}]{/magenta-fg}` : '';
    const walletTag = ` {blue-fg}[${shorten(event.wallet)}]{/blue-fg}`;

    const entry =
      `{bold}{green-fg}[${event.timestamp.toLocaleTimeString()}]{/green-fg}{/bold}` +
      walletTag +
      platform +
      ` {cyan-fg}[NEW COIN]{/cyan-fg} ` +
      `{yellow-fg}Mint:{/yellow-fg} ${event.mintAddress} ` +
      `{yellow-fg}Prog:{/yellow-fg} ${progName} ` +
      `{yellow-fg}Slot:{/yellow-fg} ${event.slot}`;

    this.logBox.add(entry);
    this.statsBox.setContent(
      this.statsBox.content.replace(/New Coins: \d+/, `New Coins: ${this.eventCount}`)
    );
    this.logBox.setScrollPerc(100);
    this.screen.render();
  }

  onError(error: string): void {
    this.logBox.add(`{red-fg}[ERROR] ${error}{/red-fg}`);
    this.logBox.setScrollPerc(100);
    this.screen.render();
  }
}
