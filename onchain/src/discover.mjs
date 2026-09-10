import { findLiveMarket } from './markets.mjs';
const asset = (process.env.ASSET || 'ETH').toUpperCase();
const market = await findLiveMarket(asset);
if (!market) throw new Error(`No live tUSDC market found for ${asset}. Try again in a minute.`);
const minutes = Math.round((Number(market.expiry) - Date.now() / 1000) / 60);
console.log(`Found ${market.asset} market. Expires in about ${minutes} minutes.`);
console.log(`pool=${market.pool}`);
console.log(`marketId=${market.marketId}`);

