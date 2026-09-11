# DelayGuard

**Directional price protection for people waiting to buy or sell crypto.**

When someone is waiting for a bank transfer or P2P payment before buying crypto, a price rise can make the purchase more expensive. When they are waiting to sell, a price fall can reduce what they receive.

DelayGuard maps that simple risk to a DreamDEX Event Contract on Somnia:

- Buying later → price going up is the risk → protect with **Up**.
- Selling later → price going down is the risk → protect with **Down**.

DelayGuard is directional protection, not a guaranteed price lock or guaranteed profit.

## Main flow

The public app is designed to work without a PC or private-key setup:

1. Open DelayGuard in MetaMask or Rabby.
2. Connect a wallet on Somnia Shannon testnet.
3. Create a Buy Later or Sell Later plan.
4. DelayGuard checks that the wallet has STT for gas.
5. If DreamDEX test USDC is missing, the app can request it from the testnet faucet.
6. DelayGuard finds a currently live BTC or ETH Event Contract and checks its onchain status.
7. The wallet approves the real testnet DreamDEX order.
8. A receipt is only saved if the order actually fills and a transaction hash is returned.
9. After settlement, the same wallet can claim a winning position from the receipt page.

The website never asks for a private key.

## Real proof, not a fake receipt

A local plan is not labelled as protected. The app only changes the receipt to **Onchain** after DreamDEX reports a non-zero fill and returns a Somnia transaction hash. Zero-fill or failed transactions are shown as failures.

The receipt stores the wallet, market ID, Event Contract outcome, amount filled, expiry and transaction hash. The explorer link provides public proof.

## Testnet requirements

Use a disposable Somnia Shannon testnet wallet. It needs a little **STT** for gas. DreamDEX trading uses its own testnet collateral token from `SOMNIA_TESTNET_ADDRESSES.testUsdc`.

No real money is required.

## Optional CLI fallback

The `onchain/` folder is kept as a developer fallback and evidence tool. It can discover markets, request test collateral, place protection and claim after settlement from a local testnet-only key. The public browser app is the primary experience.

```bash
npm run onchain:fund
npm run onchain:discover
npm run onchain:protect
npm run onchain:claim
```

Never commit `.env`, `market.json` or wallet files.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Why DreamDEX is essential

DelayGuard is not just a price alert. DreamDEX Event Contracts create the real Up or Down position, settle the result and allow a winning position to be redeemed. Without DreamDEX there is no protection position or settlement proof.

## Stack

- Vite + browser JavaScript
- Viem browser wallet client
- `@somnia-chain/markets-sdk`
- Somnia Shannon testnet
- DreamDEX Event Contracts
