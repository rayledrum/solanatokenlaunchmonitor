import * as blessed from 'blessed';
import { WalletEntry } from './config';

export interface SelectionResult {
  selected: WalletEntry[];
}

export function showWalletSelector(
  wallets: WalletEntry[]
): Promise<WalletEntry[]> {
  return new Promise((resolve) => {
    const checked = new Array(wallets.length).fill(true);

    const screen = blessed.screen({
      smartCSR: true,
      title: 'Select Wallets to Monitor',
    });

    const box = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      border: { type: 'line' },
      label: ' Select Wallets to Monitor ',
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } },
    });

    const titleText = blessed.text({
      parent: box,
      top: 0,
      left: 1,
      content: ' {bold}SPACE{/bold} toggle  |  {bold}ENTER{/bold} start  |  {bold}A{/bold} all  |  {bold}N{/bold} none  |  {bold}q{/bold} quit',
      tags: true,
      style: { fg: 'yellow' },
    });

    const list = blessed.list({
      parent: box,
      top: 2,
      left: 1,
      width: '100%-2',
      height: '100%-3',
      keys: true,
      vi: true,
      tags: true,
      style: {
        fg: 'white',
        selected: { fg: 'white', bg: 'blue' },
        item: { fg: 'white' },
      },
      items: wallets.map((w, i) =>
        `${checked[i] ? '{green-fg}[X]{/green-fg}' : '{red-fg}[ ]{/red-fg}'} {bold}${w.nickname}{/bold}  ${w.address.slice(0, 8)}...${w.address.slice(-8)}`
      ),
    });

    const hintBar = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      content: ' {bold}Tip:{/bold} Create a {yellow-fg}wallets.json{/yellow-fg} file to skip this screen next time (see README)',
      tags: true,
      style: { fg: 'white', bg: 'black', border: { fg: 'white' } },
    });

    function updateItems(): void {
      list.setItems(
        wallets.map((w, i) =>
          `${checked[i] ? '{green-fg}[X]{/green-fg}' : '{red-fg}[ ]{/red-fg}'} {bold}${w.nickname}{/bold}  ${w.address.slice(0, 8)}...${w.address.slice(-8)}`
        )
      );
      screen.render();
    }

    function toggleCurrent(): void {
      const idx = (list as any).selected as number;
      if (idx >= 0 && idx < checked.length) {
        checked[idx] = !checked[idx];
        updateItems();
      }
    }

    list.key('space', toggleCurrent);
    list.key('a', () => {
      checked.fill(true);
      updateItems();
    });
    list.key('n', () => {
      checked.fill(false);
      updateItems();
    });
    function doSubmit(): void {
      const selected = wallets.filter((_, i) => checked[i]);
      if (selected.length === 0) return;
      screen.destroy();
      resolve(selected);
    }

    list.key(['enter', 'return', 'C-m'], doSubmit);
    screen.key(['enter', 'return', 'C-m'], doSubmit);
    list.key(['q', 'Q', 'C-c'], () => {
      process.exit(0);
    });

    list.focus();
    screen.render();
  });
}
