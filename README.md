# Solana Token Launch Monitor

Real-time CLI tool that monitors Solana wallet addresses for all transactions — buys, sells, token creations, and transfers — color-coded in a terminal dashboard.

## How It Works

1. Connects to Solana via WebSocket (`logsSubscribe`)
2. Streams all log messages from the monitored wallets in real-time
3. Classifies each transaction by type using log patterns and program invocations
4. Fetches full transaction details only for token creations (to extract the mint address)
5. Displays in a live terminal UI with color-coded entries

Detection works across all platforms that create SPL tokens (pump.fun, Moonshot, Bonk.fun, direct token creation, etc.) because they all ultimately invoke the Token Program's `InitializeMint` instruction via CPI.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- npm

## Installation

```bash
git clone https://github.com/rayledrum/solanatokenlaunchmonitor.git
cd solanatokenlaunchmonitor
npm install
npm run build
```

## Usage

```bash
node dist/index.js [wallet-addresses|config.json] [rpc-url]
```

### Mode 1: Direct wallet addresses

```bash
node dist/index.js GpM5bRq7eSMNCPeM6QbY6oFq2JqPqJqPqJqPqJqPqJqP
node dist/index.js addr1,addr2,addr3
node dist/index.js addr1,addr2 https://api.mainnet-beta.solana.com
```

### Mode 2: Config file with nicknames (recommended)

Create a `wallets.json`:

```json
{
  "wallets": [
    { "nickname": "dev1", "address": "GpM5bRq7eSMN..." },
    { "nickname": "dev2", "address": "AbCdEf1234..." }
  ]
}
```

Then run:

```bash
node dist/index.js wallets.json
```

A wallet picker UI will appear showing your nicknames with checkboxes:

```
[ ] dev1  (GpM5bRq7...)
[X] dev2  (AbCdEf12...)
```

Press **SPACE** to toggle, **ENTER** to start monitoring selected wallets.

### Mode 3: Auto-detect (no arguments)

```bash
node dist/index.js
```

Looks for config files at `./wallets.json`, `~/.config/solana-wallet-monitor/wallets.json`, or `~/.solanawatch.json`.

### Controls

| Key     | Action                        |
|---------|-------------------------------|
| `q`     | Quit                          |
| SPACE   | Toggle wallet in picker       |
| ENTER   | Start monitoring (picker)     |
| `a`     | Select all (picker)           |
| `n`     | Select none (picker)          |

## Output

New coin creations show the **ticker symbol** (e.g., `$MYCOIN`) fetched from the Metaplex metadata account. If metadata isn't available yet, it falls back to the mint address.

Each transaction is color-coded by type:

| Color  | Type       | Description                         |
|--------|------------|-------------------------------------|
| Green  | `BUY`      | Token purchase / swap in            |
| Red    | `SELL`     | Token sale / swap out               |
| White  | `CREATE`   | New token mint detected + address   |
| Blue   | `TRANSFER` | SOL or SPL token transfer           |
| Yellow | `TX`       | Unclassified transaction            |

The status bar shows running counts for each type.

## Transaction Classification

Classification is done entirely from log messages — no full transaction fetch for buys/sells/transfers (only creations fetch the full tx to extract the mint address). This keeps the tool fast even on high-volume wallets.

## Wallet Config File

Create a `wallets.json` to use nicknames instead of raw addresses:

```json
{
  "wallets": [
    { "nickname": "dev1", "address": "GpM5bRq7eSMN..." },
    { "nickname": "dev2", "address": "AbCdEf1234..." }
  ]
}
```

Auto-detected config paths (in order):
1. `./wallets.json`
2. `./solana-wallet-monitor.json`
3. `~/.config/solana-wallet-monitor/wallets.json`
4. `~/.solanawatch.json`

## Adding Launchpads

Add known launchpad programs in `src/monitor.ts`:

```typescript
const KNOWN_LAUNCHPADS = [
  { id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'pump.fun' },
  { id: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', name: 'Moonshot' },
];
```

## Project Structure

```
src/
  index.ts    — CLI entry point, argument parsing, multi-wallet orchestration
  monitor.ts  — Solana WebSocket subscription, log parsing, mint extraction
  tui.ts      — Terminal UI (blessed dashboard)
```

## License

MIT
