# DelayGuard

**A price-protection receipt for people waiting to buy or sell crypto.**

When a person waits for a bank transfer or P2P payment before buying crypto, a price rise can make the purchase more expensive. When they wait to sell, a price fall can reduce what they receive. DelayGuard maps that simple risk to a DreamDEX Event Contract.

- Buying later? A price rise is the risk, so the protection side is **Up**.
- Selling later? A price fall is the risk, so the protection side is **Down**.

DelayGuard is **directional protection**, not a perfect price lock, investment advice, or guaranteed profit.

## What is in this repository

1. A fast website for explaining the plan, connecting a Somnia wallet and creating a clear protection receipt.
2. A testnet onchain companion using `@somnia-chain/markets-sdk`. It discovers a compatible live DreamDEX Event Contract, buys the selected direction, verifies that the transaction actually filled, saves the real transaction hash, and claims a winning position after settlement.

## Run a real Somnia testnet protection

Use a new **Somnia Shannon testnet-only wallet**. Never use a wallet holding real funds.

### 1. Get a little STT for gas

Use an official Somnia Shannon faucet. STT has no real-world value and is only used for testnet gas.

Somnia faucet: https://testnet.somnia.network/

If the main faucet is unavailable, Somnia's network documentation also lists Google Cloud, Stakely and Thirdweb testnet faucets.

### 2. Configure the test wallet

Copy `.env.example` to `.env` and set the private key for this disposable testnet-only wallet.

Never paste a real wallet/private key into the public website and never commit `.env`.

### 3. Install the onchain companion

```bash
cd onchain
npm install
```

### 4. Ask DreamDEX for test collateral

Once the wallet has STT, DelayGuard can request the required DreamDEX test USDC itself:

```bash
npm run fund
```

This checks the STT balance, calls DreamDEX's public testnet collateral faucet when needed, then verifies that tUSDC arrived.

### 5. Find a compatible live Event Contract

```bash
npm run discover
```

If no matching ETH/BTC market is live, DelayGuard fails instead of silently using the wrong asset. Try again when the next DreamDEX window appears.

### 6. Place protection

Set `PLAN=BUY_LATER` or `PLAN=SELL_LATER` in the root `.env`, then run:

```bash
npm run protect
```

DelayGuard checks the onchain market state before sending. A reverted or zero-fill order is treated as a failure. `market.json` is only written after a real fill and includes the transaction hash for proof.

### 7. Claim after settlement

After the Event Contract resolves:

```bash
npm run claim
```

A winning position is redeemed and the claim transaction hash is saved. A losing receipt is marked settled and is not falsely shown as claimable.

## Root commands

From the repository root you can also use:

```bash
npm run onchain:fund
npm run onchain:discover
npm run onchain:protect
npm run onchain:claim
```

## Why DreamDEX is essential

DelayGuard is not a price alert. DreamDEX Event Contracts create the actual Up or Down position, settle the outcome and produce a claimable onchain result. Without that Event Contract there is no protection position or settlement proof.

## Safety notes

- Testnet only for this hackathon build.
- Use a disposable testnet-only wallet.
- Do not commit `.env`, `market.json` or wallet files.
- Never paste a private key into the public website.
- Event Contract winnings must be claimed after settlement.

## Stack

- Static HTML, CSS and JavaScript
- EIP-1193 browser wallet connection
- `@somnia-chain/markets-sdk` + Viem for the testnet execution companion
- Somnia Shannon testnet + DreamDEX Event Contracts
