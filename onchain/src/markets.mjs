import { marketCreatorEventsAbi } from '@somnia-chain/markets-sdk/dist/eventsAbi.js';
import { pub, COLLATERAL } from './client.mjs';

export async function findLiveMarket(assetPreference) {
  const event = marketCreatorEventsAbi.find((item) => item.name === 'MarketCreated');
  const head = await pub.getBlockNumber();
  const found = [];
  for (let index = 0; index < 40; index += 1) {
    const to = head - BigInt(index * 1000);
    try {
      const logs = await pub.getLogs({ event, fromBlock: to - 999n, toBlock: to });
      found.push(...logs.map((log) => log.args));
    } catch { /* A failed log window should not stop discovery. */ }
  }
  const now = Math.floor(Date.now() / 1000);
  const live = found.filter((market) => Number(market.expiry) > now + 120 && market.collateral?.toLowerCase() === COLLATERAL.toLowerCase());
  const matchingAsset = live.filter((market) => String(market.asset).toUpperCase().includes(assetPreference));
  return (matchingAsset.length ? matchingAsset : live).sort((a, b) => Number(a.intervalSec) - Number(b.intervalSec) || Number(a.expiry) - Number(b.expiry))[0];
}

