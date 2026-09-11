import { probabilityToPrice } from '@somnia-chain/markets-sdk';
import { writeFileSync } from 'fs';
import { ex, ONE, me } from './client.mjs';
import { findLiveMarket } from './markets.mjs';

const plan = (process.env.PLAN || 'BUY_LATER').toUpperCase();
const asset = (process.env.ASSET || 'ETH').toUpperCase();
const amount = BigInt(Math.max(1, Math.floor(Number(process.env.PROTECTION_AMOUNT || 1)))) * ONE;
const direction = plan === 'SELL_LATER' ? 'DOWN' : 'UP';
const side = direction === 'UP' ? 'BUY_YES' : 'BUY_NO';
const market = await findLiveMarket(asset);
if (!market) throw new Error(`No live tUSDC Event Contract found for ${asset}. The market may be between windows. Try again shortly.`);

const details = await ex.client.getMarketOnchain(market.marketId);
if (details.finalized || details.status !== 1) throw new Error('The selected market is no longer trading. Run the command again so DelayGuard can select the next live window.');

const now = Math.floor(Date.now() / 1000);
const expiresAt = Math.min(now + 120, Number(details.expiry) - 1);
if (expiresAt <= now) throw new Error('This market is too close to expiry. Wait for the next Event Contract window.');

console.log(`DelayGuard: ${plan} protects the ${direction} side of ${market.asset}.`);
console.log(`Wallet: ${me}`);
console.log(`Market: ${market.marketId}`);
console.log(`Expires: ${new Date(Number(market.expiry) * 1000).toISOString()}`);
console.log(`Buying ${direction} directly with test collateral…`);

// Buy the desired outcome directly. Do NOT mint an Up+Down set first: minting is
// inventory preparation for sellers/market makers and unnecessarily locks twice
// the position for a one-sided DelayGuard protection.
const order = await ex.trader.placeOrder({
  pool: market.pool,
  side,
  price: probabilityToPrice(0.99),
  quantity: amount,
  outcomeToken: details.outcomeToken,
  yesId: details.yesId,
  noId: details.noId,
  orderType: 2,
  expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n
});

if (order.receipt?.status === 'reverted') {
  throw new Error(`Protection transaction reverted onchain (${order.hash || 'unknown tx'}). Check test USDC/STT balance and retry.`);
}

const filled = (order.fills || []).reduce((sum, f) => sum + f.quantityFilled, 0n);
if (filled === 0n) {
  throw new Error(`No ${direction} liquidity filled. Nothing was recorded as protected. Try the next live market window.`);
}

const receipt = {
  version: 2,
  network: 'Somnia Shannon testnet',
  wallet: me,
  plan,
  asset: market.asset,
  direction,
  marketId: market.marketId,
  pool: market.pool,
  yesId: String(details.yesId),
  noId: String(details.noId),
  outcomeToken: details.outcomeToken,
  requested: Number(amount) / 1e6,
  filled: Number(filled) / 1e6,
  transactionHash: order.hash,
  marketExpiry: Number(market.expiry),
  createdAt: new Date().toISOString()
};
writeFileSync(new URL('../../market.json', import.meta.url), JSON.stringify(receipt, null, 2));
console.log(`Protection confirmed: ${receipt.filled} ${direction} shares`);
console.log(`tx: ${receipt.transactionHash}`);
console.log('Saved verified market.json. After settlement, run: npm run claim');
process.exit(0);
