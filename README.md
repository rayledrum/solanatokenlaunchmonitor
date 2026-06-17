# Solana Token Launch Monitor

Real-time CLI tool that monitors Solana wallet addresses for new token creations. Detects when a dev wallet creates a new coin on pump.fun, Moonshot, or any other launchpad, and displays alerts in a terminal dashboard.

## How It Works

1. Connects to Solana via WebSocket (`logsSubscribe`)
2. Streams all log messages from the monitored wallets in real-time
3. Scans for `InitializeMint` instructions (Token Program CPI) and known launchpad program invocations
4. Fetches the transaction to extract the new mint address and platform
5. Displays in a live terminal UI

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

Each detected coin creation shows:
- **Time** of detection
- **Wallet** tag that created it (when monitoring multiple)
- **Platform** tag (pump.fun, Moonshot, or unknown)
- **Mint address** of the new token
- **Token Program** used (Token or Token2022)
- **Slot** number

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
