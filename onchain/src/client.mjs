import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { createPublicClient, http } from 'viem';
import { somniaTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from 'dotenv';

config({ path: new URL('../../.env', import.meta.url) });
const { PRIVATE_KEY, RPC_URL, WS_RPC_URL, INDEXER_URL } = process.env;
if (!PRIVATE_KEY || PRIVATE_KEY === '0x...') throw new Error('Set a funded testnet-only PRIVATE_KEY in the root .env file.');

export const me = privateKeyToAccount(PRIVATE_KEY).address;
export const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.testUsdc;
export const ONE = 1_000_000n;
export const pub = createPublicClient({ chain: somniaTestnet, transport: http(RPC_URL || undefined) });
export const ex = new SomniaMarkets({
  chain: somniaTestnet,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: PRIVATE_KEY,
  wsRpcUrl: WS_RPC_URL || 'wss://api.infra.testnet.somnia.network/ws',
  indexerUrl: INDEXER_URL || 'https://dev.smk.somnia.host/v1/graphql'
});

