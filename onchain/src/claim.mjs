import { readFileSync, writeFileSync } from 'fs';
import { ex, me } from './client.mjs';
const url = new URL('../../market.json', import.meta.url);
const receipt = JSON.parse(readFileSync(url, 'utf8'));
if (!receipt.marketId || !receipt.transactionHash) throw new Error('market.json is not a verified DelayGuard protection receipt. Place protection first.');
if (receipt.wallet && receipt.wallet.toLowerCase() !== me.toLowerCase()) throw new Error('This receipt belongs to a different wallet. Use the wallet that created the protection.');
console.log('Checking Event Contract settlement…');
const market = await ex.client.getMarketOnchain(receipt.marketId);
if (!market.finalized && !market.isResolved && !market.isVoided) throw new Error('This market has not settled yet. Wait for settlement, then try again.');
if (market.isVoided) throw new Error('This Event Contract was voided. DelayGuard will not guess a winning side. Use DreamDEX settlement tooling for the refundable position.');
const winningOutcome = Number(market.winningOutcome);
const protectedOutcome = receipt.direction === 'UP' ? 0 : 1;
if (winningOutcome !== protectedOutcome) {
  receipt.status = 'SETTLED_NOT_WINNER'; receipt.settledAt = new Date().toISOString();
  writeFileSync(url, JSON.stringify(receipt,null,2));
  console.log('The protected direction did not win. There is nothing to claim from this position.'); process.exit(0);
}
const id = winningOutcome === 0 ? receipt.yesId : receipt.noId;
const balance = await ex.client.getOutcomeBalance({ outcomeToken: market.outcomeToken, account: me, id: BigInt(id) });
if (balance === 0n) { console.log('The protected side won, but this wallet has no claimable balance. It may already have been redeemed.'); process.exit(0); }
const result = await ex.trader.redeem({ marketId: receipt.marketId, outcomeIdx: winningOutcome, amount: balance });
if (result.receipt?.status === 'reverted') throw new Error(`Claim reverted onchain (${result.hash || 'unknown tx'}).`);
receipt.status='CLAIMED'; receipt.claimTransactionHash=result.hash; receipt.claimedAt=new Date().toISOString();
writeFileSync(url,JSON.stringify(receipt,null,2));
console.log(`claim tx: ${result.hash}`);
process.exit(0);
