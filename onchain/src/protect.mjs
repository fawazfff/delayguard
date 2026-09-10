import { probabilityToPrice } from '@somnia-chain/markets-sdk';
import { writeFileSync } from 'fs';
import { ex, ONE, me } from './client.mjs';
import { findLiveMarket } from './markets.mjs';

const plan = (process.env.PLAN || 'BUY_LATER').toUpperCase();
const asset = (process.env.ASSET || 'ETH').toUpperCase();
const amount = BigInt(Math.max(1, Number(process.env.PROTECTION_AMOUNT || 1))) * ONE;
const direction = plan === 'SELL_LATER' ? 'DOWN' : 'UP';
const side = direction === 'UP' ? 'BUY_YES' : 'BUY_NO';
const market = await findLiveMarket(asset);
if (!market) throw new Error(`No live tUSDC market found for ${asset}. Try again in a minute.`);
const details = await ex.client.getMarketOnchain(market.marketId);
if (details.finalized || details.status !== 1) throw new Error('The selected market is no longer trading. Run the command again.');

console.log(`DelayGuard: ${plan} means protecting the ${direction} side of ${market.asset}.`);
console.log(`Wallet: ${me}`);
console.log(`Market expires at: ${new Date(Number(market.expiry) * 1000).toISOString()}`);
console.log('Minting a testnet Up + Down set…');
const minted = await ex.trader.mintSet({ pool: market.pool, amount });
console.log(`mint tx: ${minted.hash}`);
console.log(`Buying ${direction} with an IOC order…`);
const order = await ex.trader.placeOrder({ pool: market.pool, side, price: probabilityToPrice(0.99), quantity: amount, orderType: 2 });
const fill = (order.fills || [])[0];
if (!fill) console.log('No matching order filled. The minted set remains in the wallet. Try another live market or run again later.');
else console.log(`fill: ${Number(fill.quantityFilled) / 1e6} at ${Number(fill.fillPrice) / 1e6}`);
writeFileSync(new URL('../../market.json', import.meta.url), JSON.stringify({ marketId: market.marketId, pool: market.pool, asset: market.asset, direction, yesId: String(details.yesId), noId: String(details.noId), outcomeToken: details.outcomeToken, createdAt: new Date().toISOString() }, null, 2));
console.log('Saved market.json. After settlement, run: npm run claim');
process.exit(0);

