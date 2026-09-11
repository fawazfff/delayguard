import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, custom, formatUnits, parseUnits } from 'viem';

const INDEXER_URL = 'https://dev.smk.somnia.host/v1/graphql';
const WS_RPC_URL = 'wss://api.infra.testnet.somnia.network/ws';
const EXPLORER = 'https://shannon-explorer.somnia.network';
const CHAIN_HEX = `0x${somniaShannon.id.toString(16)}`;
const STORAGE_KEY = 'take-it-position-v1';

const exchange = new SomniaMarkets({
  indexerUrl: INDEXER_URL,
  chain: somniaShannon,
  wsRpcUrl: WS_RPC_URL,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

const state = {
  asset: 'BTC', side: 'UP', market: null, wallet: null, walletClient: null,
  position: null, watchHandle: null, quoteTimer: null, clockTimer: null, busy: false,
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 3600);
}
function errText(error) { return error?.shortMessage || error?.message || 'Something went wrong.'; }
function fmt(raw, decimals, max = 4) {
  const n = Number(formatUnits(BigInt(raw || 0), Number(decimals || 6)));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}
function marketId(m) { return m?.marketId || m?.id; }
function intervalLabel(m) {
  if (m?.interval) return m.interval;
  const s = Number(m?.intervalSec || 0);
  if (!s) return 'live round';
  if (s % 3600 === 0) return `${s / 3600}h`;
  return `${Math.round(s / 60)}m`;
}
function outcomeSymbol(m, side) {
  const suffix = side === 'UP' ? '#YES' : '#NO';
  return m?.outcomes?.find((o) => String(o.symbol).toUpperCase().endsWith(suffix))?.symbol || null;
}
function extractTxHash(value) {
  const xs = [value?.txHash, value?.hash, value?.info?.hash, value?.info?.transactionHash, value?.info?.receipt?.transactionHash, value?.receipt?.transactionHash];
  return xs.find((v) => typeof v === 'string' && /^0x[a-fA-F0-9]{64}$/.test(v)) || null;
}
function setBusy(on, text) {
  state.busy = on;
  $('#enterButton').disabled = on || !state.market;
  if (text) $('#status').textContent = text;
}
async function ensureSomnia() {
  if (!window.ethereum) throw new Error('No browser wallet found. Open TAKE IT inside MetaMask or Rabby.');
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'Somnia Shannon Testnet', nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 }, rpcUrls: ['https://dream-rpc.somnia.network'], blockExplorerUrls: [EXPLORER] }] });
  }
}
async function connectWallet() {
  await ensureSomnia();
  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!address) throw new Error('No wallet selected.');
  const walletClient = createWalletClient({ account: address, chain: somniaShannon, transport: custom(window.ethereum) });
  state.wallet = address;
  state.walletClient = walletClient;
  exchange.setSigner({ walletClient });
  $('#walletLabel').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return address;
}
async function ensureFunding(m) {
  const native = await exchange.client.getViemClient().getBalance({ address: state.wallet });
  if (native === 0n) throw new Error('This wallet has no STT for gas. Fund it with Somnia Shannon test STT first.');
  const collateral = m.collateral || SOMNIA_TESTNET_ADDRESSES.collateral || SOMNIA_TESTNET_ADDRESSES.testUsdc;
  if (!collateral) return;
  let bal = await exchange.client.getErc20Balance(collateral, state.wallet);
  if (bal > 0n) return;
  $('#status').textContent = 'No test collateral found. Requesting it from the DreamDEX faucet…';
  const faucet = await exchange.trader.faucet();
  if (faucet?.receipt?.status === 'reverted') throw new Error('The DreamDEX collateral faucet reverted.');
  await sleep(1400);
  bal = await exchange.client.getErc20Balance(collateral, state.wallet);
  if (bal === 0n) throw new Error('The live market uses collateral this wallet does not have. Faucet funds did not arrive for that token.');
}
async function stopWatch() {
  if (state.watchHandle?.stop) { try { state.watchHandle.stop(); } catch {} }
  state.watchHandle = null;
}
async function watchMarket(m) {
  await stopWatch();
  if (!m?.poolAddress) return;
  state.watchHandle = await exchange.client.watchMarket(m.poolAddress);
}
async function discoverMarket() {
  if (state.position) return;
  try {
    $('#marketStatus').textContent = 'Finding live DreamDEX market…';
    $('#enterButton').disabled = true;
    const listed = await exchange.client.listLiveBinaryMarkets({ asset: state.asset, limit: 30 });
    const now = Math.floor(Date.now() / 1000);
    let chosen = null;
    for (const m of listed) {
      if (String(m.asset).toUpperCase() !== state.asset || Number(m.expiry) - now < 45) continue;
      const onchain = await exchange.client.getMarketOnchain(marketId(m));
      if (onchain?.status === 1) { chosen = m; break; }
    }
    if (!chosen) throw new Error(`No live ${state.asset} Event Contract is tradeable right now.`);
    state.market = chosen;
    await watchMarket(chosen);
    $('#assetTitle').textContent = state.asset;
    $('#marketInterval').textContent = intervalLabel(chosen);
    $('#marketQuestion').textContent = chosen.question || `Will ${state.asset} finish this round higher than it started?`;
    $('#marketStatus').textContent = `Trading now · DreamDEX · ${intervalLabel(chosen)}`;
    $('#collateralSymbol').textContent = chosen.quoteSymbol || chosen.collateralSymbol || 'collateral';
    $('#enterButton').disabled = false;
    const addr = chosen.marketAddress || chosen.poolAddress;
    if (addr) { $('#marketLink').href = `${EXPLORER}/address/${addr}`; $('#marketLink').hidden = false; }
    startClock(Number(chosen.expiry));
  } catch (e) {
    state.market = null;
    $('#marketStatus').textContent = errText(e);
    $('#marketQuestion').textContent = 'Waiting for a tradeable DreamDEX Event Contract.';
    $('#countdown').textContent = '--:--';
    $('#enterButton').disabled = true;
  }
}
function startClock(expiry) {
  clearInterval(state.clockTimer);
  const render = () => {
    const left = Math.max(0, expiry - Math.floor(Date.now() / 1000));
    $('#countdown').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    if (left === 0 && state.position) settlePosition();
  };
  render(); state.clockTimer = setInterval(render, 1000);
}
async function enterPosition() {
  if (state.busy || !state.market) return;
  try {
    setBusy(true, 'Connecting wallet…');
    await connectWallet();
    await ensureFunding(state.market);
    const symbol = outcomeSymbol(state.market, state.side);
    if (!symbol) throw new Error(`DreamDEX did not return the ${state.side} outcome symbol.`);
    const shares = Math.max(0.1, Number($('#stake').value || 1));
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Enter a valid number of shares.');
    $('#status').textContent = `Buying ${shares} ${state.side} share${shares === 1 ? '' : 's'} on DreamDEX. Approve in your wallet.`;
    const order = await exchange.createOrder(symbol, 'market', 'buy', shares, undefined, { slippage: 0.08, timeInForce: 'IOC' });
    const filled = Number(order?.filled || 0);
    if (!order || filled <= 0) throw new Error('No liquidity filled this order. Nothing was marked as entered.');
    const txHash = extractTxHash(order);
    if (!txHash) throw new Error('DreamDEX reported a fill but no transaction hash was returned.');
    const decimals = Number(state.market.quoteDecimals || 6);
    const position = {
      asset: state.asset, side: state.side, wallet: state.wallet, marketId: marketId(state.market), poolAddress: state.market.poolAddress,
      marketAddress: state.market.marketAddress, marketSymbol: state.market.symbol, outcomeSymbol: symbol, decimals,
      collateral: state.market.collateral, collateralSymbol: state.market.quoteSymbol || state.market.collateralSymbol || 'collateral',
      shares: filled, entryRequestedShares: shares, expiry: Number(state.market.expiry), entryTx: txHash, createdAt: new Date().toISOString(), status: 'open'
    };
    state.position = position;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    showPosition();
    await refreshCashoutQuote();
    beginQuoteLoop();
    toast('Real DreamDEX position opened.');
  } catch (e) {
    $('#status').textContent = errText(e);
    toast(errText(e));
  } finally { setBusy(false); }
}
function showPosition() {
  const p = state.position;
  if (!p) return;
  $('#setupView').hidden = true; $('#resultView').hidden = true; $('#positionView').hidden = false;
  $('#assetTitle').textContent = p.asset; $('#marketInterval').textContent = state.market ? intervalLabel(state.market) : 'live round';
  $('#positionSide').textContent = `${p.side} ${p.side === 'UP' ? '↑' : '↓'}`;
  $('#entryValue').textContent = `${p.entryRequestedShares} shares`;
  $('#shareValue').textContent = Number(p.shares).toLocaleString(undefined,{maximumFractionDigits:6});
  $('#payoutValue').textContent = `up to ${Number(p.shares).toLocaleString(undefined,{maximumFractionDigits:4})}`;
  $('#offerSymbol').textContent = p.collateralSymbol;
  $('#entryTx').href = `${EXPLORER}/tx/${p.entryTx}`; $('#entryTx').hidden = false;
  if (p.exitTx) { $('#exitTx').href = `${EXPLORER}/tx/${p.exitTx}`; $('#exitTx').hidden = false; }
  startClock(p.expiry);
}
async function restorePosition() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!saved || saved.status === 'closed' || saved.status === 'claimed' || saved.status === 'lost') return false;
  try {
    const markets = await exchange.client.listBinaryMarkets({ asset: saved.asset, limit: 100 });
    state.market = markets.find((m) => String(marketId(m)).toLowerCase() === String(saved.marketId).toLowerCase()) || await exchange.client.getMarket(saved.marketId);
    state.position = saved; state.asset = saved.asset; state.side = saved.side;
    if (state.market?.poolAddress) await watchMarket(state.market);
    showPosition(); beginQuoteLoop(); await refreshCashoutQuote(); return true;
  } catch { state.position = saved; showPosition(); return true; }
}
function beginQuoteLoop() {
  clearInterval(state.quoteTimer);
  state.quoteTimer = setInterval(refreshCashoutQuote, 3000);
}
async function refreshCashoutQuote() {
  const p = state.position;
  if (!p || p.status !== 'open' || !state.market) return;
  try {
    const decimals = Number(p.decimals || state.market.quoteDecimals || 6);
    const rawQty = parseUnits(String(p.shares), decimals);
    const quote = await exchange.client.quoteBinarySell({ marketId: p.marketId, side: p.side === 'UP' ? 'SELL_YES' : 'SELL_NO', quantity: rawQty, depth: 10, slippageBps: 300n });
    if (!quote || quote.fillableQuantity <= 0n) {
      $('#offerValue').textContent = '—'; $('#cashoutButton').disabled = true; $('#cashoutButton').textContent = 'NO CASH-OUT OFFER RIGHT NOW';
      $('#positionStatus').textContent = 'No executable DreamDEX bid is available for this position yet.'; $('#liquidityWarning').hidden = true; return;
    }
    const proceeds = fmt(quote.estProceeds, decimals, 4);
    p.lastQuote = { proceeds, rawFillable: quote.fillableQuantity.toString(), rawQuantity: quote.quantity.toString(), at: Date.now() };
    state.position = p; localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    $('#offerValue').textContent = proceeds;
    $('#cashoutButton').disabled = false; $('#cashoutButton').textContent = `TAKE ${proceeds} ${p.collateralSymbol} NOW`;
    $('#positionStatus').textContent = 'Executable estimate from the live DreamDEX resting bids. Final fill can move before confirmation.';
    $('#liquidityWarning').hidden = quote.fillableQuantity >= quote.quantity;
    if (!$('#liquidityWarning').hidden) $('#liquidityWarning').textContent = `Only ${fmt(quote.fillableQuantity, decimals, 6)} of ${fmt(quote.quantity, decimals, 6)} shares are currently fillable.`;
  } catch (e) {
    $('#cashoutButton').disabled = true; $('#cashoutButton').textContent = 'CASH-OUT QUOTE UNAVAILABLE'; $('#positionStatus').textContent = errText(e);
  }
}
async function cashOut() {
  const p = state.position;
  if (!p || state.busy || !p.lastQuote) return;
  try {
    state.busy = true; $('#cashoutButton').disabled = true; $('#positionStatus').textContent = 'Refreshing the DreamDEX cash-out quote…';
    await connectWallet();
    if (state.wallet.toLowerCase() !== p.wallet.toLowerCase()) throw new Error('Connect the same wallet that opened this position.');
    const decimals = Number(p.decimals || 6);
    const rawQty = parseUnits(String(p.shares), decimals);
    const quote = await exchange.client.quoteBinarySell({ marketId: p.marketId, side: p.side === 'UP' ? 'SELL_YES' : 'SELL_NO', quantity: rawQty, depth: 10, slippageBps: 300n });
    if (!quote || quote.fillableQuantity <= 0n) throw new Error('That cash-out offer disappeared. No sell was sent.');
    const sellShares = Number(formatUnits(quote.fillableQuantity, decimals));
    $('#positionStatus').textContent = `Selling ${sellShares} share${sellShares === 1 ? '' : 's'} into live DreamDEX bids. Approve in your wallet.`;
    const order = await exchange.createOrder(p.outcomeSymbol, 'market', 'sell', sellShares, undefined, { slippage: 0.08, timeInForce: 'IOC' });
    const filled = Number(order?.filled || 0); if (filled <= 0) throw new Error('The cash-out order found no fill. Your position remains open.');
    const txHash = extractTxHash(order); if (!txHash) throw new Error('The exit filled but no transaction hash was returned.');
    p.status = filled + 1e-9 >= Number(p.shares) ? 'closed' : 'partial'; p.exitTx = txHash; p.exitFilledShares = filled; p.exitQuotedProceeds = fmt(quote.estProceeds, decimals, 4); p.closedAt = new Date().toISOString();
    state.position = p; localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); clearInterval(state.quoteTimer);
    $('#exitTx').href = `${EXPLORER}/tx/${txHash}`; $('#exitTx').hidden = false;
    showResult('DEAL TAKEN', `DreamDEX filled a real sell for ${filled} ${p.side} share${filled === 1 ? '' : 's'}. The quoted proceeds before confirmation were about ${p.exitQuotedProceeds} ${p.collateralSymbol}.`, txHash);
    toast('Cash-out filled onchain.');
  } catch (e) { $('#positionStatus').textContent = errText(e); toast(errText(e)); await refreshCashoutQuote(); }
  finally { state.busy = false; }
}
function showResult(title, copy, txHash) {
  $('#setupView').hidden = true; $('#positionView').hidden = true; $('#resultView').hidden = false;
  $('#resultTitle').textContent = title; $('#resultCopy').textContent = copy;
  $('#resultProof').innerHTML = txHash ? `<a href="${EXPLORER}/tx/${txHash}" target="_blank" rel="noreferrer">View Somnia transaction ↗</a>` : 'Verified from the live DreamDEX market.';
}
async function settlePosition() {
  const p = state.position; if (!p || p.status !== 'open') return;
  clearInterval(state.quoteTimer);
  try {
    const m = await exchange.client.getMarketOnchain(p.marketId);
    if (!m?.finalized && !m?.isResolved && !m?.isVoided) { $('#positionStatus').textContent = 'Trading ended. Waiting for DreamDEX settlement…'; setTimeout(settlePosition, 5000); return; }
    const idx = p.side === 'UP' ? 0 : 1;
    if (!m.isVoided && Number(m.winningOutcome) !== idx) { p.status = 'lost'; localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); showResult('ROUND LOST', `You held ${p.side}. DreamDEX settled the other side.`, null); return; }
    $('#positionStatus').textContent = 'Your side is claimable.'; $('#claimButton').hidden = false; showResult('YOU HELD IT', `Your ${p.side} position survived to settlement. Claim the winning outcome from the same wallet.`, null); $('#claimButton').hidden = false;
  } catch (e) { $('#positionStatus').textContent = `Settlement check: ${errText(e)}`; }
}
async function claim() {
  const p = state.position; if (!p) return;
  try {
    $('#claimButton').disabled = true; await connectWallet();
    if (state.wallet.toLowerCase() !== p.wallet.toLowerCase()) throw new Error('Connect the same wallet that opened this position.');
    const m = await exchange.client.getMarketOnchain(p.marketId); const idx = p.side === 'UP' ? 0 : 1;
    const tokenId = idx === 0 ? m.yesId : m.noId;
    const bal = await exchange.client.getOutcomeBalance({ outcomeToken: m.outcomeToken, account: state.wallet, id: BigInt(tokenId) });
    if (bal === 0n) throw new Error('No claimable winning balance was found.');
    const result = await exchange.trader.redeem({ marketId: p.marketId, outcomeIdx: idx, amount: bal });
    if (result?.receipt?.status === 'reverted') throw new Error('Claim reverted onchain.');
    const hash = extractTxHash(result); if (!hash) throw new Error('Claim sent but no transaction hash was returned.');
    p.status = 'claimed'; p.claimTx = hash; localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    $('#claimButton').hidden = true; showResult('CLAIMED', 'The winning DreamDEX outcome was redeemed on Somnia Shannon testnet.', hash); toast('Winning position claimed.');
  } catch (e) { toast(errText(e)); $('#claimButton').disabled = false; }
}
function resetRound() {
  localStorage.removeItem(STORAGE_KEY); state.position = null; state.market = null; clearInterval(state.quoteTimer); $('#positionView').hidden = true; $('#resultView').hidden = true; $('#setupView').hidden = false; $('#exitTx').hidden = true; discoverMarket();
}

$$('.asset-tab').forEach((b) => b.addEventListener('click', async () => { if (state.position) return; state.asset = b.dataset.asset; $$('.asset-tab').forEach((x) => x.classList.toggle('selected', x === b)); await discoverMarket(); }));
$$('.side').forEach((b) => b.addEventListener('click', () => { if (state.position) return; state.side = b.dataset.side; $$('.side').forEach((x) => x.classList.toggle('selected', x === b)); $('#entrySide').textContent = state.side; }));
$('#walletButton').addEventListener('click', async () => { try { await connectWallet(); toast('Wallet connected to Somnia Shannon.'); } catch (e) { toast(errText(e)); } });
$('#enterButton').addEventListener('click', enterPosition); $('#cashoutButton').addEventListener('click', cashOut); $('#holdButton').addEventListener('click', () => { toast('Holding. TAKE IT will keep watching until settlement.'); }); $('#claimButton').addEventListener('click', claim); $('#newRoundButton').addEventListener('click', resetRound);
if (window.ethereum?.on) window.ethereum.on('accountsChanged', () => { state.wallet = null; state.walletClient = null; $('#walletLabel').textContent = 'Connect wallet'; });

(async function init(){ const restored = await restorePosition(); if (!restored) await discoverMarket(); })();