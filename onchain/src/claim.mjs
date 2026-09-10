import { readFileSync } from 'fs';
import { ex, me } from './client.mjs';
const receipt = JSON.parse(readFileSync(new URL('../../market.json', import.meta.url), 'utf8'));
console.log('Checking whether the selected Event Contract has settled…');
const market = await ex.client.getMarketOnchain(receipt.marketId);
if (!market.finalized && !market.isResolved && !market.isVoided) throw new Error('This market has not settled yet. Wait for settlement, then run this command again.');
if (market.isVoided) { console.log('This market was voided. Both sides may be refundable at 0.5.'); }
const outcome = market.isVoided ? (receipt.direction === 'UP' ? 0 : 1) : Number(market.winningOutcome);
const id = outcome === 0 ? receipt.yesId : receipt.noId;
const balance = await ex.client.getOutcomeBalance({ outcomeToken: market.outcomeToken, account: me, id: BigInt(id) });
if (balance === 0n) { console.log('There is no claimable balance for this outcome in this wallet.'); process.exit(0); }
const result = await ex.trader.redeem({ marketId: receipt.marketId, outcomeIdx: outcome, amount: balance });
console.log(`claim tx: ${result.hash}`);
process.exit(0);
