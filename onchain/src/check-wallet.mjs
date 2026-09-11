import { createPublicClient, http, isAddress, getAddress, formatEther, formatUnits } from 'viem';
import { somniaTestnet } from 'viem/chains';
import { SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';

const raw = process.argv[2] || process.env.WALLET_ADDRESS;
if (!raw || !isAddress(raw)) {
  throw new Error('Usage: npm run check -- 0xYOUR_WALLET_ADDRESS');
}

const address = getAddress(raw);
const rpc = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const client = createPublicClient({ chain: somniaTestnet, transport: http(rpc) });
const tUSDC = SOMNIA_TESTNET_ADDRESSES.testUsdc;
const erc20Abi = [{
  type: 'function',
  name: 'balanceOf',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }]
}];

const [gas, collateral] = await Promise.all([
  client.getBalance({ address }),
  client.readContract({ address: tUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
]);

console.log(`Wallet: ${address}`);
console.log(`Network: Somnia Shannon testnet (${somniaTestnet.id})`);
console.log(`STT: ${formatEther(gas)}`);
console.log(`DreamDEX tUSDC: ${formatUnits(collateral, 6)}`);
console.log(`tUSDC contract: ${tUSDC}`);

if (gas === 0n) console.log('STATUS: NEED_STT');
else if (collateral === 0n) console.log('STATUS: NEED_DREAMDEX_TUSDC');
else console.log('STATUS: READY_FOR_DELAYGUARD');
