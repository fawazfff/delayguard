import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, custom, formatUnits } from 'viem';

const INDEXER_URL = 'https://dev.smk.somnia.host/v1/graphql';
const WS_RPC_URL = 'wss://api.infra.testnet.somnia.network/ws';
const SOMNIA_HEX_CHAIN_ID = `0x${somniaShannon.id.toString(16)}`;
const EXPLORER = 'https://shannon-explorer.somnia.network';
const PROTECTION_SHARES = 1;

const exchange = new SomniaMarkets({
  indexerUrl: INDEXER_URL,
  chain: somniaShannon,
  wsRpcUrl: WS_RPC_URL,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

const state = {
  intent: 'buy',
  asset: 'ETH',
  amount: '100',
  currency: 'USD',
  minutes: '15',
  wallet: null,
  walletClient: null,
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = $('#toast');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function direction() {
  return state.intent === 'buy' ? 'UP' : 'DOWN';
}

function contractSide() {
  return `${state.asset} ${direction() === 'UP' ? 'Up' : 'Down'}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 4200);
}

function setStatus(message, mode = 'working') {
  const el = $('#receiptStatus');
  if (el) el.textContent = message;
  const badge = $('#receiptBadge');
  if (badge) badge.textContent = mode === 'done' ? 'Onchain' : mode === 'error' ? 'Needs action' : 'Working';
}

function setBusy(value, label) {
  state.busy = value;
  const button = $('#executeProtection');
  if (!button) return;
  button.disabled = value;
  button.textContent = value ? label || 'Working…' : 'Protect on Somnia testnet →';
}

function updatePreview() {
  const rising = state.intent === 'buy';
  $('#previewAsset').textContent = state.asset;
  $('#previewAssetIcon').textContent = state.asset === 'ETH' ? 'Ξ' : '₿';
  $('#previewAssetIcon').className = `token-icon ${state.asset.toLowerCase()}`;
  $('#previewWindow').textContent = `${state.minutes} minute window`;
  $('#previewTitle').textContent = rising
    ? 'Buying later means a price rise is the risk.'
    : 'Selling later means a price fall is the risk.';
  $('#previewDescription').textContent = rising
    ? `DelayGuard will protect the wait with the ${state.asset} Up side of a live DreamDEX Event Contract.`
    : `DelayGuard will protect the wait with the ${state.asset} Down side of a live DreamDEX Event Contract.`;
  $('#previewSide').textContent = contractSide();
  $('#previewExplanation').textContent = rising
    ? `${state.asset} rising makes your future purchase more expensive.`
    : `${state.asset} falling makes your future sale worth less.`;
}

async function ensureSomnia() {
  if (!window.ethereum) throw new Error('No browser wallet found. Open DelayGuard inside MetaMask or Rabby and try again.');
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SOMNIA_HEX_CHAIN_ID }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: SOMNIA_HEX_CHAIN_ID,
        chainName: 'Somnia Shannon Testnet',
        nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
        rpcUrls: ['https://dream-rpc.somnia.network'],
        blockExplorerUrls: [EXPLORER],
      }],
    });
  }
}

async function connectWallet() {
  await ensureSomnia();
  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!address) throw new Error('No wallet account was selected.');
  const walletClient = createWalletClient({ account: address, chain: somniaShannon, transport: custom(window.ethereum) });
  state.wallet = address;
  state.walletClient = walletClient;
  exchange.setSigner({ walletClient });
  $('#walletLabel').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  $('#walletButton').classList.add('connected');
  return address;
}

async function readFunding() {
  if (!state.wallet) return null;
  const [nativeBalance, tusdcRaw] = await Promise.all([
    exchange.client.getViemClient().getBalance({ address: state.wallet }),
    exchange.client.getErc20Balance(SOMNIA_TESTNET_ADDRESSES.testUsdc, state.wallet),
  ]);
  return { nativeBalance, tusdcRaw, tusdc: Number(formatUnits(tusdcRaw, 6)) };
}

async function ensureTestCollateral() {
  const before = await readFunding();
  if (!before) throw new Error('Connect your wallet first.');
  if (before.nativeBalance === 0n) throw new Error('This wallet has no STT for gas. Fund it with Somnia Shannon test STT first.');
  if (before.tusdc >= 2) return before;

  setStatus('Requesting free DreamDEX test USDC. Approve the faucet transaction in your wallet.');
  setBusy(true, 'Getting test USDC…');
  const faucet = await exchange.trader.faucet();
  if (faucet?.receipt?.status === 'reverted') throw new Error('The DreamDEX test USDC faucet transaction reverted.');
  await sleep(1800);
  const after = await readFunding();
  if (!after || after.tusdc <= 0) throw new Error('DreamDEX test USDC did not arrive. Check the faucet transaction and retry.');
  return after;
}

async function findBestMarket() {
  setStatus(`Finding a live ${state.asset} DreamDEX Event Contract…`);
  setBusy(true, 'Finding live market…');
  const now = Math.floor(Date.now() / 1000);
  const wantedSeconds = Number(state.minutes) * 60;
  const collateral = SOMNIA_TESTNET_ADDRESSES.testUsdc.toLowerCase();
  const listed = await exchange.client.listLiveBinaryMarkets({ asset: state.asset, limit: 50 });
  const candidates = [];

  for (const market of listed) {
    if (String(market.asset).toUpperCase() !== state.asset) continue;
    if (market.collateral?.toLowerCase() !== collateral) continue;
    const secondsLeft = Number(market.expiry) - now;
    if (secondsLeft < 60) continue;
    const onchain = await exchange.client.getMarketOnchain(market.marketId);
    if (!onchain || onchain.status !== 1) continue;
    candidates.push({ market, onchain, secondsLeft });
  }

  if (!candidates.length) {
    throw new Error(`No live ${state.asset} DreamDEX Event Contract using test USDC is trading right now. Try again when the next window opens.`);
  }

  candidates.sort((a, b) => {
    const aCadence = Number(a.market.intervalSec || a.secondsLeft);
    const bCadence = Number(b.market.intervalSec || b.secondsLeft);
    return Math.abs(aCadence - wantedSeconds) - Math.abs(bCadence - wantedSeconds) || a.secondsLeft - b.secondsLeft;
  });
  return candidates[0];
}

function extractTxHash(value) {
  const possible = [value?.txHash, value?.hash, value?.info?.hash, value?.info?.transactionHash, value?.info?.receipt?.transactionHash, value?.receipt?.transactionHash];
  return possible.find((v) => typeof v === 'string' && /^0x[a-fA-F0-9]{64}$/.test(v)) || null;
}

function saveRealReceipt(receipt) {
  localStorage.setItem('delayguard-real-receipt-v1', JSON.stringify(receipt));
  renderRealReceipt(receipt);
}

function renderRealReceipt(receipt) {
  if (!receipt) return;
  $('#receiptAction').textContent = `${receipt.plan === 'BUY_LATER' ? 'Buying' : 'Selling'} ${receipt.asset} later`;
  $('#receiptRisk').textContent = `Protected if ${receipt.asset} ${receipt.direction === 'UP' ? 'rises' : 'falls'}`;
  $('#receiptAmount').textContent = `Plan: ${receipt.plannedAmount} ${receipt.currency} · ${receipt.requestedMinutes} minutes`;
  $('#receiptSide').textContent = `${receipt.asset} ${receipt.direction === 'UP' ? 'Up' : 'Down'}`;
  $('#receiptBadge').textContent = receipt.claimHash ? 'Claimed' : receipt.settlement === 'lost' ? 'Settled' : 'Onchain';
  $('#receiptStatus').textContent = receipt.claimHash
    ? 'Protection settled and the winning position was claimed onchain.'
    : receipt.settlement === 'lost'
      ? 'This Event Contract settled on the other side. There is nothing to claim.'
      : `Onchain protection confirmed. ${receipt.filled} share${receipt.filled === 1 ? '' : 's'} filled.`;

  const txLink = $('#receiptTxLink');
  if (txLink && receipt.transactionHash) {
    txLink.href = `${EXPLORER}/tx/${receipt.transactionHash}`;
    txLink.textContent = 'View protection transaction ↗';
    txLink.hidden = false;
  }
  const claimButton = $('#claimProtection');
  if (claimButton) claimButton.hidden = Boolean(receipt.claimHash || receipt.settlement === 'lost');
  location.hash = 'receipt';
}

function createPlanReceipt() {
  $('#receiptAction').textContent = `${state.intent === 'buy' ? 'Buying' : 'Selling'} ${state.asset} later`;
  $('#receiptRisk').textContent = `Protected if ${state.asset} ${state.intent === 'buy' ? 'rises' : 'falls'}`;
  $('#receiptAmount').textContent = `Plan: ${state.amount} ${state.currency} · ${state.minutes} minutes`;
  $('#receiptSide').textContent = contractSide();
  $('#receiptBadge').textContent = 'Ready';
  $('#receiptStatus').textContent = 'Plan ready. Press Protect on Somnia testnet to create the real onchain position.';
  $('#executeProtection').hidden = false;
  $('#claimProtection').hidden = true;
  location.hash = 'receipt';
}

async function executeProtection() {
  if (state.busy) return;
  try {
    setBusy(true, 'Connecting wallet…');
    setStatus('Connect your wallet to Somnia Shannon testnet.');
    await connectWallet();
    await ensureTestCollateral();

    const { market } = await findBestMarket();
    const outcome = direction() === 'UP' ? 'YES' : 'NO';
    const outcomeSymbol = market.outcomes?.find((item) => String(item.symbol).toUpperCase().endsWith(`#${outcome}`))?.symbol;
    if (!outcomeSymbol) throw new Error(`DreamDEX returned a live market but no ${outcome} outcome symbol.`);

    setStatus(`Buying ${state.asset} ${direction()} protection. Your wallet may ask for a one-time tUSDC approval before the order.`);
    setBusy(true, 'Approve in wallet…');
    const order = await exchange.createOrder(outcomeSymbol, 'market', 'buy', PROTECTION_SHARES, undefined, { slippage: 0.08, timeInForce: 'IOC' });
    if (!order || Number(order.filled || 0) <= 0) throw new Error('The order found no available liquidity. DelayGuard did not mark you as protected. Try another live window.');

    const txHash = extractTxHash(order);
    if (!txHash) throw new Error('The order filled but the SDK did not return a transaction hash. Nothing fake was saved.');

    const receipt = {
      version: 4,
      network: 'Somnia Shannon testnet',
      wallet: state.wallet,
      plan: state.intent === 'buy' ? 'BUY_LATER' : 'SELL_LATER',
      asset: state.asset,
      direction: direction(),
      marketId: market.marketId,
      marketSymbol: market.symbol,
      outcomeSymbol,
      outcome,
      outcomeTokenId: outcome === 'YES' ? market.yesTokenId : market.noTokenId,
      filled: Number(order.filled),
      orderStatus: order.status,
      transactionHash: txHash,
      marketExpiry: Number(market.expiry),
      plannedAmount: state.amount,
      currency: state.currency,
      requestedMinutes: Number(state.minutes),
      createdAt: new Date().toISOString(),
    };
    saveRealReceipt(receipt);
    $('#executeProtection').hidden = true;
    $('#claimProtection').hidden = false;
    setStatus('Real DreamDEX protection confirmed on Somnia testnet.', 'done');
    showToast('Onchain protection confirmed.');
  } catch (error) {
    console.error(error);
    setStatus(error?.shortMessage || error?.message || 'Protection failed. Nothing was marked as protected.', 'error');
    showToast(error?.shortMessage || error?.message || 'Protection failed.');
  } finally {
    setBusy(false);
  }
}

async function claimProtection() {
  if (state.busy) return;
  const receipt = JSON.parse(localStorage.getItem('delayguard-real-receipt-v1') || 'null');
  if (!receipt?.marketId) { showToast('No real onchain protection receipt was found in this browser.'); return; }

  try {
    state.busy = true;
    setStatus('Checking the Event Contract settlement…');
    await connectWallet();
    if (state.wallet.toLowerCase() !== receipt.wallet.toLowerCase()) {
      throw new Error(`Connect the same wallet that created this protection: ${receipt.wallet.slice(0, 6)}…${receipt.wallet.slice(-4)}`);
    }

    const market = await exchange.client.getMarketOnchain(receipt.marketId);
    if (!market.finalized && !market.isResolved && !market.isVoided) throw new Error('This Event Contract has not settled yet. Try Claim again after its expiry.');

    const outcomeIdx = receipt.outcome === 'YES' ? 0 : 1;
    if (!market.isVoided && Number(market.winningOutcome) !== outcomeIdx) {
      receipt.settlement = 'lost';
      receipt.settledAt = new Date().toISOString();
      saveRealReceipt(receipt);
      setStatus('The market settled on the other side. Nothing is claimable.', 'done');
      return;
    }

    const tokenId = outcomeIdx === 0 ? market.yesId : market.noId;
    const balance = await exchange.client.getOutcomeBalance({ outcomeToken: market.outcomeToken, account: state.wallet, id: BigInt(tokenId) });
    if (balance === 0n) throw new Error('This wallet has no claimable balance for the winning outcome.');

    setStatus('Winning position found. Approve the DreamDEX claim in your wallet.');
    const result = await exchange.trader.redeem({ marketId: receipt.marketId, outcomeIdx, amount: balance });
    if (result?.receipt?.status === 'reverted') throw new Error('The claim transaction reverted onchain.');
    const claimHash = extractTxHash(result);
    if (!claimHash) throw new Error('The claim was sent but its transaction hash could not be read.');

    receipt.claimHash = claimHash;
    receipt.claimedAt = new Date().toISOString();
    receipt.settlement = market.isVoided ? 'voided-claimed' : 'won-claimed';
    saveRealReceipt(receipt);
    setStatus('Winning protection claimed onchain.', 'done');
    showToast('Claim confirmed.');
  } catch (error) {
    console.error(error);
    setStatus(error?.shortMessage || error?.message || 'Claim is not available yet.', 'error');
    showToast(error?.shortMessage || error?.message || 'Claim is not available yet.');
  } finally {
    state.busy = false;
  }
}

$$('.choice').forEach((button) => button.addEventListener('click', () => {
  state.intent = button.dataset.intent;
  $$('.choice').forEach((item) => item.classList.toggle('selected', item === button));
  updatePreview();
}));
$$('.time-choice').forEach((button) => button.addEventListener('click', () => {
  state.minutes = button.dataset.time;
  $$('.time-choice').forEach((item) => item.classList.toggle('selected', item === button));
  updatePreview();
}));
$('#asset').addEventListener('change', (event) => { state.asset = event.target.value; updatePreview(); });
$('#amount').addEventListener('input', (event) => { state.amount = event.target.value.replace(/[^0-9.]/g, '').slice(0, 10) || '0'; });
$('#currency').addEventListener('change', (event) => { state.currency = event.target.value; });
$('#protectionForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (Number(state.amount) <= 0) { showToast('Enter an amount bigger than zero.'); return; }
  createPlanReceipt();
});
$('#walletButton').addEventListener('click', async () => {
  try { await connectWallet(); const funding = await readFunding(); showToast(`Wallet connected. DreamDEX tUSDC: ${funding ? funding.tusdc : 0}`); }
  catch (error) { showToast(error?.shortMessage || error?.message || 'Wallet connection failed.'); }
});
$('#executeProtection')?.addEventListener('click', executeProtection);
$('#claimProtection')?.addEventListener('click', claimProtection);

if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', (accounts) => {
    state.wallet = accounts[0] || null;
    state.walletClient = null;
    exchange.setSigner({});
    if (!state.wallet) {
      $('#walletLabel').textContent = 'Connect wallet';
      $('#walletButton').classList.remove('connected');
    } else {
      $('#walletLabel').textContent = `${state.wallet.slice(0, 6)}…${state.wallet.slice(-4)}`;
    }
  });
}

const savedRealReceipt = JSON.parse(localStorage.getItem('delayguard-real-receipt-v1') || 'null');
if (savedRealReceipt) renderRealReceipt(savedRealReceipt);
updatePreview();
