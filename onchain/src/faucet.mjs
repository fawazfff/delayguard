import { ex, COLLATERAL, me, ONE, pub } from './client.mjs';

console.log(`DelayGuard test wallet: ${me}`);
const gas = await pub.getBalance({ address: me });
console.log(`STT gas balance: ${Number(gas) / 1e18}`);
if (gas === 0n) {
  throw new Error('This wallet has 0 STT. Get a small amount of Somnia Shannon test STT first, then run this command again.');
}

const before = await ex.client.getErc20Balance(COLLATERAL, me);
console.log(`tUSDC before: ${Number(before) / Number(ONE)}`);

if (before < 100n * ONE) {
  console.log('Requesting test USDC from the official DreamDEX testnet faucet…');
  const result = await ex.trader.faucet();
  if (result?.receipt?.status === 'reverted') {
    throw new Error(`DreamDEX faucet transaction reverted (${result.hash || 'unknown tx'}).`);
  }
  if (result?.hash) console.log(`faucet tx: ${result.hash}`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
} else {
  console.log('Enough tUSDC already available. Faucet request skipped.');
}

const after = await ex.client.getErc20Balance(COLLATERAL, me);
console.log(`tUSDC ready: ${Number(after) / Number(ONE)}`);
if (after === 0n) throw new Error('No test USDC was received. Check the faucet transaction and try again.');
console.log('DelayGuard test wallet is funded for DreamDEX collateral. You can now run: npm run protect');
process.exit(0);
