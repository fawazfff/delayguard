# TAKE IT

**Pick a side. Then decide when to leave.**

TAKE IT turns DreamDEX Event Contracts into a simple live decision game.

Choose whether BTC or ETH finishes **UP** or **DOWN**. After a real DreamDEX order fills, TAKE IT watches the live order book and shows the amount your position can currently sell for. You can cash out early with a real sell order or hold until DreamDEX settles the Event Contract.

Built for the **Somnia × DreamDEX Event Contracts Hackathon**.

## The idea

Prediction markets usually make the most interesting part look like a trading terminal. TAKE IT hides the complexity behind one understandable question:

> Take the cash-out offer now, or hold for the final result?

The cash-out value is not simulated. TAKE IT uses DreamDEX liquidity and only enables cash out when the SDK reports a real executable sell quote.

## Demo flow

1. Connect MetaMask or Rabby on Somnia Shannon testnet.
2. TAKE IT discovers a currently tradeable BTC or ETH DreamDEX Event Contract.
3. Pick **UP** or **DOWN**.
4. Buy a small outcome position through DreamDEX.
5. The app watches the live DreamDEX order book.
6. If bids exist, TAKE IT displays an executable estimated cash-out value.
7. Press **TAKE IT** to sell the position early onchain, or hold until settlement.
8. A winning held position can be redeemed after DreamDEX finalizes the market.

## DreamDEX integration

TAKE IT uses `@somnia-chain/markets-sdk` for:

- live binary Event Contract discovery
- authoritative onchain market status checks
- browser-wallet signing
- real market buy orders
- live market watching
- `quoteBinarySell()` cash-out estimates
- real market sell orders
- settlement checks
- winning outcome redemption

A local browser state is never treated as proof of a trade. Entry, exit and claim states require DreamDEX/Somnia transaction results.

## Safety / testnet

- Somnia Shannon testnet only
- no private keys are requested or stored
- the connected wallet signs every write
- no fake market prices or fake cash-out offers
- if there is no executable bid, the UI says there is no cash-out offer

## Stack

- Vite
- Vanilla JavaScript
- `@somnia-chain/markets-sdk`
- viem
- Somnia Shannon testnet
- Vercel

## Run locally

```bash
npm install
npm run dev
```

## Production

https://delayguard-tau.vercel.app/

The Vercel project is connected to this repository. Pushes to `main` trigger a production deployment.
