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
node dist/index.js <wallet-addresses> [rpc-url]
```

### Examples

Monitor a single dev wallet:
```bash
node dist/index.js GpM5bRq7eSMNCPeM6QbY6oFq2JqPqJqPqJqPqJqPqJqP
```

Monitor multiple wallets (comma-separated):
```bash
node dist/index.js addr1,addr2,addr3
```

Use a custom RPC endpoint:
```bash
node dist/index.js addr1,addr2 https://api.mainnet-beta.solana.com
```

### Controls

| Key | Action |
|-----|--------|
| `q` | Quit |

## Output

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

## Configuration

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
