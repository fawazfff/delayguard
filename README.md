# DelayGuard

**A price-protection receipt for people waiting to buy or sell crypto.**

When a person waits for a bank transfer or a P2P payment before buying crypto, a price rise can make that purchase more expensive. When they wait to sell, a price fall can make their sale worth less. DelayGuard maps that simple real-life risk to a DreamDEX Event Contract.

- Buying later? A price rise is the risk, so the protection side is **Up**.
- Selling later? A price fall is the risk, so the protection side is **Down**.

DelayGuard is **directional protection**, not a perfect price lock, investment advice, or a guaranteed profit.

## What is in this repository

1. A fast static website with a wallet connection button and a working demo receipt creator.
2. An optional onchain companion using `@somnia-chain/markets-sdk`. It discovers a live DreamDEX Event Contract, mints a testnet set, buys the selected direction using an IOC order, saves the receipt data, and claims the winning side after settlement.

## Website demo

Open `index.html`, or run:

```bash
npm run start
```

Then open `http://localhost:3000`.

The website saves demo receipts only in the browser's local storage. It never asks for a private key, stores a wallet address on a server, or pretends to submit an onchain transaction.

## Run a real testnet protection

The onchain companion is intentionally separate from the website. That keeps keys out of the browser and makes every real transaction explicit.

1. Create a new Somnia **Shannon testnet-only** wallet. Never use a wallet with real funds.
2. Request test STT for gas and test USDC collateral from the Somnia hackathon developer community.
3. Copy `.env.example` to `.env` and set the testnet-only private key.
4. Install the small companion:

```bash
cd onchain
npm install
```

5. Discover current live DreamDEX markets:

```bash
npm run discover
```

6. Set `PLAN=BUY_LATER` or `PLAN=SELL_LATER` in the root `.env`, then place protection:

```bash
npm run protect
```

7. Once the selected market resolves, claim the winning side:

```bash
npm run claim
```

`npm run protect` writes `market.json` locally, which is ignored by Git. The terminal prints transaction hashes for evidence.

## Why DreamDEX is essential

DelayGuard is not just a price alert. It needs DreamDEX Event Contracts to create the actual Up or Down position, settle the outcome, and produce a claimable onchain result. Without an Event Contract, there is no protection position or settlement receipt.

## Safety notes

- Testnet only for this hackathon build.
- Do not paste a private key into the public website.
- Do not commit `.env`, `market.json`, or wallet files.
- A winning Event Contract position must be claimed after settlement. It does not automatically turn into collateral.

## Stack

- Static HTML, CSS, and JavaScript for a small, fast public site
- Browser wallet connection via EIP-1193
- `@somnia-chain/markets-sdk` + Viem in the optional Node.js onchain companion
- Somnia Shannon testnet and DreamDEX Event Contracts

