import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, custom, formatUnits, parseUnits } from 'viem';

const INDEXER_URL = 'https://dev.smk.somnia.host/v1/graphql';
const WS_RPC_URL = 'wss://api.infra.testnet.somnia.network/ws';
const EXPLORER = 'https://shannon-explorer.somnia.network';
const SITE_HOST = 'delayguard-tau.vercel.app';
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
  position: null, quoteTimer: null, clockTimer: null, discoveryTimer: null, busy: false,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4200);
}
function errText(error) { return error?.shortMessage || error?.message || 'Something went wrong.'; }
function marketId(m) { return m?.marketId || m?.id; }
function intervalLabel(m) {
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
function fmt(raw, decimals = 6, max = 4) {
  try { return Number(formatUnits(BigInt(raw || 0), decimals)).toLocaleString(undefined, { maximumFractionDigits: max }); }
  catch { return '0'; }
}
function setBusy(on, text) {
  state.busy = on;
  $('#enterButton').disabled = on || !state.market;
  if (text) $('#status').textContent = text;
}

function setupWalletButton() {
  if (window.ethereum) {
    $('#walletLabel').textContent = state.wallet ? `${state.wallet.slice(0, 6)}…${state.wallet.slice(-4)}` : 'Connect wallet';
  } else {
    $('#walletLabel').textContent = 'Open in MetaMask';
    $('#status').textContent = 'This browser cannot connect directly to a crypto wallet. Tap “Open in MetaMask” above, then use TAKE IT inside MetaMask’s browser.';
  }
}

async function ensureSomnia() {
  if (!window.ethereum) {
    window.location.href = `https://metamask.app.link/dapp/${SITE_HOST}`;
    throw new Error('Opening TAKE IT inside MetaMask…');
  }
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CHAIN_HEX,
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
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const address = accounts?.[0];
  if (!address) throw new Error('No wallet account was selected.');
  const walletClient = createWalletClient({ account: address, chain: somniaShannon, transport: custom(window.ethereum) });
  state.wallet = address;
  state.walletClient = walletClient;
  exchange.setSigner({ walletClient });
  $('#walletLabel').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  toast('Wallet connected to Somnia Shannon.');
  return address;
}

async function ensureFunding(m) {
  const native = await exchange.client.getViemClient().getBalance({ address: state.wallet });
  if (native === 0n) throw new Error('This wallet has no STT for gas. Add Somnia Shannon test STT first.');
  const collateral = m.collateral || SOMNIA_TESTNET_ADDRESSES.testUsdc;
  if (!collateral) return;
  let bal = await exchange.client.getErc20Balance(collateral, state.wallet);
  if (bal > 0n) return;
  $('#status').textContent = 'No test collateral found. Requesting DreamDEX test collateral…';
  const faucet = await exchange.trader.faucet();
  if (faucet?.receipt?.status === 'reverted') throw new Error('DreamDEX test collateral faucet reverted.');
  await sleep(1800);
  bal = await exchange.client.getErc20Balance(collateral, state.wallet);
  if (bal === 0n) throw new Error('Test collateral did not arrive.');
}

async function discoverMarket() {
  if (state.position || state.busy) return;
  clearTimeout(state.discoveryTimer);
  try {
    $('#marketStatus').textContent = 'Reading live DreamDEX markets…';
    $('#marketQuestion').textContent = `Looking for the next ${state.asset} round…`;
    $('#enterButton').disabled = true;

    const listed = await exchange.client.listLiveBinaryMarkets({ asset: state.asset, limit: 50 });
    const now = Math.floor(Date.now() / 1000);
    const candidates = (listed || []).filter((m) => {
      const secondsLeft = Number(m.expiry || 0) - now;
      return String(m.asset).toUpperCase() === state.asset && secondsLeft > 45 && outcomeSymbol(m, 'UP') && outcomeSymbol(m, 'DOWN');
    });

    candidates.sort((a, b) => {
      const ai = Number(a.intervalSec || 999999);
      const bi = Number(b.intervalSec || 999999);
      return ai - bi || Number(a.expiry) - Number(b.expiry);
    });

    const chosen = candidates[0];
    if (!chosen) {
      state.market = null;
      $('#marketStatus').textContent = `No open ${state.asset} round found yet. Checking again automatically.`;
      $('#marketQuestion').textContent = `Waiting for the next DreamDEX ${state.asset} Event Contract.`;
      $('#countdown').textContent = '--:--';
      state.discoveryTimer = setTimeout(discoverMarket, 6000);
      return;
    }

    state.market = chosen;
    $('#assetTitle').textContent = state.asset;
    $('#marketInterval').textContent = intervalLabel(chosen);
    $('#marketQuestion').textContent = chosen.question || `Will ${state.asset} finish this round higher than it started?`;
    $('#marketStatus').textContent = `Live on DreamDEX · ${intervalLabel(chosen)} round`;
    $('#enterButton').disabled = false;

    const addr = chosen.marketAddress || chosen.poolAddress;
    if (addr) {
      $('#marketLink').href = `${EXPLORER}/address/${addr}`;
      $('#marketLink').hidden = false;
    }
    startClock(Number(chosen.expiry));
  } catch (e) {
    state.market = null;
    $('#marketStatus').textContent = 'DreamDEX is slow right now. Retrying automatically…';
    $('#marketQuestion').textContent = `Waiting for the next DreamDEX ${state.asset} Event Contract.`;
    $('#countdown').textContent = '--:--';
    $('#enterButton').disabled = true;
    console.warn('Market discovery retry:', e);
    state.discoveryTimer = setTimeout(discoverMarket, 6000);
  }
}

function startClock(expiry) {
  clearInterval(state.clockTimer);
  const render = () => {
    const left = Math.max(0, expiry - Math.floor(Date.now() / 1000));
    $('#countdown').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    if (left === 0) {
      clearInterval(state.clockTimer);
      if (state.position) settlePosition(); else discoverMarket();
    }
  };
  render();
  state.clockTimer = setInterval(render, 1000);
}

async function enterPosition() {
  if (state.busy || !state.market) return;
  try {
    setBusy(true, 'Connect your wallet to continue.');
    await connectWallet();
    await ensureFunding(state.market);

    const symbol = outcomeSymbol(state.market, state.side);
    if (!symbol) throw new Error(`DreamDEX did not return the ${state.side} outcome symbol.`);
    const shares = Math.max(0.1, Number($('#stake').value || 1));
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Enter a valid number of shares.');

    $('#status').textContent = `Buying ${shares} ${state.side} share${shares === 1 ? '' : 's'} on DreamDEX. Approve in your wallet.`;
    const order = await exchange.createOrder(symbol, 'market', 'buy', shares, undefined, { slippage: 0.12, timeInForce: 'IOC' });
    const filled = Number(order?.filled || 0);
    if (filled <= 0) throw new Error('This round had no fillable liquidity. No trade was made. Try the next round.');
    const txHash = extractTxHash(order);
    if (!txHash) throw new Error('DreamDEX reported a fill but no transaction hash was returned.');

    const position = {
      asset: state.asset,
      side: state.side,
      wallet: state.wallet,
      marketId: marketId(state.market),
      marketAddress: state.market.marketAddress,
      poolAddress: state.market.poolAddress,
      outcomeSymbol: symbol,
      collateral: state.market.collateral,
      collateralSymbol: state.market.quoteSymbol || state.market.collateralSymbol || 'test collateral',
      quoteDecimals: Number(state.market.quoteDecimals || 6),
      shares: filled,
      entryRequestedShares: shares,
      expiry: Number(state.market.expiry),
      entryTx: txHash,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    state.position = position;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    showPosition();
    beginQuoteLoop();
    await refreshCashoutQuote();
    toast('Real DreamDEX position opened.');
  } catch (e) {
    $('#status').textContent = errText(e);
    toast(errText(e));
  } finally {
    setBusy(false);
  }
}

function showPosition() {
  const p = state.position;
  if (!p) return;
  $('#setupView').hidden = true;
  $('#resultView').hidden = true;
  $('#positionView').hidden = false;
  $('#assetTitle').textContent = p.asset;
  $('#positionSide').textContent = `${p.side} ${p.side === 'UP' ? '↑' : '↓'}`;
  $('#entryValue').textContent = `${p.entryRequestedShares} shares`;
  $('#shareValue').textContent = Number(p.shares).toLocaleString(undefined, { maximumFractionDigits: 6 });
  $('#payoutValue').textContent = `up to ${Number(p.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  $('#offerSymbol').textContent = p.collateralSymbol;
  $('#entryTx').href = `${EXPLORER}/tx/${p.entryTx}`;
  $('#entryTx').hidden = false;
  startClock(p.expiry);
}

async function restorePosition() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!saved || ['closed', 'claimed', 'lost'].includes(saved.status)) return false;
  state.position = saved;
  state.asset = saved.asset;
  state.side = saved.side;
  try {
    const listed = await exchange.client.listLiveBinaryMarkets({ asset: saved.asset, limit: 50 });
    state.market = (listed || []).find((m) => String(marketId(m)) === String(saved.marketId)) || null;
  } catch {}
  showPosition();
  if (state.market && saved.status === 'open') {
    beginQuoteLoop();
    await refreshCashoutQuote();
  }
  return true;
}

function beginQuoteLoop() {
  clearInterval(state.quoteTimer);
  state.quoteTimer = setInterval(refreshCashoutQuote, 3500);
}

async function refreshCashoutQuote() {
  const p = state.position;
  if (!p || p.status !== 'open' || !state.market) return;
  try {
    const decimals = Number(p.quoteDecimals || 6);
    const rawQty = parseUnits(String(p.shares), decimals);
    const quote = await exchange.client.quoteBinarySell({
      marketId: p.marketId,
      side: p.side === 'UP' ? 'SELL_YES' : 'SELL_NO',
      quantity: rawQty,
      depth: 10,
      slippageBps: 300n,
    });

    if (!quote || quote.fillableQuantity <= 0n) {
      $('#offerValue').textContent = '—';
      $('#cashoutButton').disabled = true;
      $('#cashoutButton').textContent = 'NO CASH-OUT OFFER RIGHT NOW';
      $('#positionStatus').textContent = 'No executable DreamDEX bid is available for this position yet.';
      return;
    }

    const proceeds = fmt(quote.estProceeds, decimals, 4);
    p.lastQuote = { proceeds, fillableQuantity: quote.fillableQuantity.toString(), at: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    $('#offerValue').textContent = proceeds;
    $('#cashoutButton').disabled = false;
    $('#cashoutButton').textContent = `TAKE ${proceeds} ${p.collateralSymbol} NOW`;
    $('#positionStatus').textContent = 'Live executable estimate from DreamDEX bids.';
  } catch (e) {
    $('#cashoutButton').disabled = true;
    $('#cashoutButton').textContent = 'CASH-OUT QUOTE UNAVAILABLE';
    $('#positionStatus').textContent = 'DreamDEX quote is temporarily unavailable. Retrying…';
  }
}

async function cashOut() {
  const p = state.position;
  if (!p || state.busy) return;
  try {
    state.busy = true;
    await connectWallet();
    if (state.wallet.toLowerCase() !== p.wallet.toLowerCase()) throw new Error('Connect the same wallet that opened this position.');

    const decimals = Number(p.quoteDecimals || 6);
    const rawQty = parseUnits(String(p.shares), decimals);
    const quote = await exchange.client.quoteBinarySell({
      marketId: p.marketId,
      side: p.side === 'UP' ? 'SELL_YES' : 'SELL_NO',
      quantity: rawQty,
      depth: 10,
      slippageBps: 300n,
    });
    if (!quote || quote.fillableQuantity <= 0n) throw new Error('That cash-out offer disappeared. No sell was sent.');

    const sellShares = Number(formatUnits(quote.fillableQuantity, decimals));
    $('#positionStatus').textContent = `Selling ${sellShares} share${sellShares === 1 ? '' : 's'} on DreamDEX. Approve in your wallet.`;
    const order = await exchange.createOrder(p.outcomeSymbol, 'market', 'sell', sellShares, undefined, { slippage: 0.12, timeInForce: 'IOC' });
    const filled = Number(order?.filled || 0);
    if (filled <= 0) throw new Error('The cash-out found no fill. Your position remains open.');
    const txHash = extractTxHash(order);
    if (!txHash) throw new Error('Exit filled but no transaction hash was returned.');

    p.status = filled + 1e-9 >= Number(p.shares) ? 'closed' : 'partial';
    p.exitTx = txHash;
    p.exitFilledShares = filled;
    p.closedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    clearInterval(state.quoteTimer);
    showResult('DEAL TAKEN', `DreamDEX filled a real sell for ${filled} ${p.side} share${filled === 1 ? '' : 's'}.`, txHash);
    toast('Cash-out filled onchain.');
  } catch (e) {
    $('#positionStatus').textContent = errText(e);
    toast(errText(e));
  } finally {
    state.busy = false;
  }
}

function showResult(title, copy, txHash) {
  $('#setupView').hidden = true;
  $('#positionView').hidden = true;
  $('#resultView').hidden = false;
  $('#resultTitle').textContent = title;
  $('#resultCopy').textContent = copy;
  $('#resultProof').innerHTML = txHash ? `<a href="${EXPLORER}/tx/${txHash}" target="_blank" rel="noreferrer">View Somnia transaction ↗</a>` : 'Verified from DreamDEX settlement.';
}

async function settlePosition() {
  const p = state.position;
  if (!p || p.status !== 'open') return;
  clearInterval(state.quoteTimer);
  $('#positionStatus').textContent = 'Round ended. Waiting for DreamDEX settlement…';
  try {
    const m = await exchange.client.getMarketOnchain(p.marketId);
    if (!m?.finalized && !m?.isResolved && !m?.isVoided) {
      setTimeout(settlePosition, 7000);
      return;
    }
    const idx = p.side === 'UP' ? 0 : 1;
    if (!m.isVoided && Number(m.winningOutcome) !== idx) {
      p.status = 'lost';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      showResult('ROUND LOST', `You held ${p.side}. DreamDEX settled the other side.`, null);
      return;
    }
    showResult('YOU HELD IT', `Your ${p.side} position won. You can claim it from the same wallet.`, null);
    $('#claimButton').hidden = false;
  } catch {
    $('#positionStatus').textContent = 'DreamDEX settlement RPC is slow. You can retry shortly.';
  }
}

async function claim() {
  const p = state.position;
  if (!p) return;
  try {
    $('#claimButton').disabled = true;
    await connectWallet();
    if (state.wallet.toLowerCase() !== p.wallet.toLowerCase()) throw new Error('Connect the same wallet that opened this position.');
    const m = await exchange.client.getMarketOnchain(p.marketId);
    const idx = p.side === 'UP' ? 0 : 1;
    const tokenId = idx === 0 ? m.yesId : m.noId;
    const bal = await exchange.client.getOutcomeBalance({ outcomeToken: m.outcomeToken, account: state.wallet, id: BigInt(tokenId) });
    if (bal === 0n) throw new Error('No claimable winning balance was found.');
    const result = await exchange.trader.redeem({ marketId: p.marketId, outcomeIdx: idx, amount: bal });
    if (result?.receipt?.status === 'reverted') throw new Error('Claim reverted onchain.');
    const hash = extractTxHash(result);
    if (!hash) throw new Error('Claim sent but no transaction hash was returned.');
    p.status = 'claimed';
    p.claimTx = hash;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    $('#claimButton').hidden = true;
    showResult('CLAIMED', 'The winning DreamDEX outcome was redeemed on Somnia Shannon testnet.', hash);
  } catch (e) {
    toast(errText(e));
    $('#claimButton').disabled = false;
  }
}

function resetRound() {
  localStorage.removeItem(STORAGE_KEY);
  state.position = null;
  state.market = null;
  clearInterval(state.quoteTimer);
  $('#positionView').hidden = true;
  $('#resultView').hidden = true;
  $('#setupView').hidden = false;
  $('#claimButton').hidden = true;
  discoverMarket();
}

$$('.asset-tab').forEach((b) => b.addEventListener('click', async () => {
  if (state.position) return;
  state.asset = b.dataset.asset;
  $$('.asset-tab').forEach((x) => x.classList.toggle('selected', x === b));
  await discoverMarket();
}));
$$('.side').forEach((b) => b.addEventListener('click', () => {
  if (state.position) return;
  state.side = b.dataset.side;
  $$('.side').forEach((x) => x.classList.toggle('selected', x === b));
  $('#entrySide').textContent = state.side;
}));

$('#walletButton').addEventListener('click', async () => {
  if (!window.ethereum) {
    window.location.href = `https://metamask.app.link/dapp/${SITE_HOST}`;
    return;
  }
  try { await connectWallet(); }
  catch (e) { toast(errText(e)); }
});
$('#enterButton').addEventListener('click', enterPosition);
$('#cashoutButton').addEventListener('click', cashOut);
$('#holdButton').addEventListener('click', () => toast('Holding until the DreamDEX result.'));
$('#claimButton').addEventListener('click', claim);
$('#newRoundButton').addEventListener('click', resetRound);

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', () => {
    state.wallet = null;
    state.walletClient = null;
    setupWalletButton();
  });
}

(async function init() {
  setupWalletButton();
  const restored = await restorePosition();
  if (!restored) await discoverMarket();
})();