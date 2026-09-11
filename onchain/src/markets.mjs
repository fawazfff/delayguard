import { marketCreatorEventsAbi } from '@somnia-chain/markets-sdk/dist/eventsAbi.js';
import { pub, COLLATERAL } from './client.mjs';

export async function findLiveMarket(assetPreference) {
  const event = marketCreatorEventsAbi.find((item) => item.name === 'MarketCreated');
  if (!event) throw new Error('DreamDEX SDK does not expose MarketCreated. Update @somnia-chain/markets-sdk.');
  const head = await pub.getBlockNumber();
  const found = [];
  for (let index = 0; index < 50; index += 1) {
    const to = head - BigInt(index * 1000);
    if (to < 1n) break;
    const from = to > 999n ? to - 999n : 0n;
    try {
      const logs = await pub.getLogs({ event, fromBlock: from, toBlock: to });
      found.push(...logs.map((log) => log.args));
    } catch { /* RPC log limits can reject a window; continue with the others. */ }
  }
  const now = Math.floor(Date.now() / 1000);
  const live = found.filter((m) => Number(m.expiry) > now + 45 && m.collateral?.toLowerCase() === COLLATERAL.toLowerCase());
  const matching = live.filter((m) => String(m.asset || '').toUpperCase().includes(assetPreference.toUpperCase()));
  // Fail closed. Never silently protect BTC with an ETH market or vice versa.
  if (!matching.length) return null;
  const candidates = matching.sort((a,b)=>Number(a.intervalSec)-Number(b.intervalSec)||Number(a.expiry)-Number(b.expiry));
  for (const market of candidates.slice(0, 8)) {
    try {
      const onchain = await (await import('./client.mjs')).ex.client.getMarketOnchain(market.marketId);
      if (!onchain.finalized && onchain.status === 1 && Number(onchain.expiry) > now + 30) return market;
    } catch { /* stale index/log candidate */ }
  }
  return null;
}
