import * as blessed from 'blessed';
import { TxEvent, MonitorStatus, TxType } from './monitor';
import { WalletEntry } from './config';

const TYPE_STYLE: Record<TxType, { fg: string; label: string }> = {
  create:   { fg: 'white',    label: 'CREATE' },
  buy:      { fg: 'green',    label: 'BUY' },
  sell:     { fg: 'red',      label: 'SELL' },
  transfer: { fg: 'blue',     label: 'TRANSFER' },
  unknown:  { fg: 'yellow',   label: 'TX' },
};

function shorten(addr: string): string {
  return addr.slice(0, 4) + '..' + addr.slice(-4);
}

export class TUI {
  private screen: blessed.Widgets.Screen;
  private titleBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private statsBox: blessed.Widgets.BoxElement;
  private counts: Record<TxType, number> = { create: 0, buy: 0, sell: 0, transfer: 0, unknown: 0 };
  private walletCount: number;
  private nicknames: Record<string, string>;

  constructor(addresses: string[], entries: WalletEntry[]) {
    this.walletCount = addresses.length;
    this.nicknames = {};
    for (const e of entries) {
      this.nicknames[e.address] = e.nickname;
    }

    const shortAddrs = entries
      .map((e) => `${e.nickname} (${shorten(e.address)})`)
      .join(', ');

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Solana Wallet Monitor',
      dockBorders: true,
    });

    const label =
      entries.length === 1
        ? `Watching: {green-fg}${shortAddrs}{/green-fg}`
        : `Watching {green-fg}${entries.length} wallets{/green-fg}: ${shortAddrs}`;

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
      content: this.formatStats('connecting...'),
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
      label: ' Transaction Log ',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'white' } },
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } },
    });

    this.screen.key(['q', 'Q', 'C-c'], () => process.exit(0));
    this.screen.render();
  }

  private formatStats(status: string): string {
    const parts = [
      `{bold}Status:{/bold} ${status}`,
      `{green-fg}Buys:{/green-fg} ${this.counts.buy}`,
      `{red-fg}Sells:{/red-fg} ${this.counts.sell}`,
      `{white-fg}Creates:{/white-fg} ${this.counts.create}`,
      `{blue-fg}Txfr:{/blue-fg} ${this.counts.transfer}`,
      `Wallets: ${this.walletCount}`,
      `Press {yellow-fg}q{/yellow-fg} to quit`,
    ];
    return ' ' + parts.join('  |  ');
  }

  private renderStats(): void {
    this.statsBox.setContent(this.formatStats('connected'));
    this.screen.render();
  }

  updateStatus(status: MonitorStatus, message?: string): void {
    this.statsBox.setContent(this.formatStats(status));
    this.screen.render();
  }

  onTx(event: TxEvent): void {
    this.counts[event.type]++;

    const style = TYPE_STYLE[event.type];
    const tag = `{${style.fg}-fg}[${style.label}]{/${style.fg}-fg}`;
    const nick = this.nicknames[event.wallet] || shorten(event.wallet);
    const walletTag = ` {blue-fg}[${nick}]{/blue-fg}`;
    const platform = event.platform ? ` {magenta-fg}[${event.platform}]{/magenta-fg}` : '';

    let extra = '';
    if (event.tokenSymbol) {
      extra = ` {white-fg}$${event.tokenSymbol}{/white-fg}`;
    } else if (event.mintAddress) {
      extra = ` {white-fg}Token:{/white-fg} ${event.mintAddress}`;
    }

    const entry =
      `{bold}{green-fg}[${event.timestamp.toLocaleTimeString()}]{/green-fg}{/bold}` +
      walletTag +
      ` ${tag}` +
      platform +
      extra;

    this.logBox.add(entry);
    this.logBox.setScrollPerc(100);
    this.renderStats();
  }

  onError(error: string): void {
    this.logBox.add(`{red-fg}[ERROR] ${error}{/red-fg}`);
    this.logBox.setScrollPerc(100);
    this.screen.render();
  }
}
