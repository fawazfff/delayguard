import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, probabilityToPrice } from '@somnia-chain/markets-sdk';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, custom, formatUnits } from 'viem';

const INDEXER_URL = 'https://dev.smk.somnia.host/v1/graphql';
const WS_RPC_URL = 'wss://api.infra.testnet.somnia.network/ws';
const EXPLORER = 'https://shannon-explorer.somnia.network';
const SITE_HOST = 'delayguard-tau.vercel.app';
const CHAIN_HEX = `0x${somniaShannon.id.toString(16)}`;
const STORAGE_KEY = 'take-it-position-v2';
const ONE = 1_000_000n;

const exchange = new SomniaMarkets({
  indexerUrl: INDEXER_URL,
  chain: somniaShannon,
  wsRpcUrl: WS_RPC_URL,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

const state = {
  asset: 'BTC', side: 'UP', market: null, wallet: null, walletClient: null,
  position: null, clockTimer: null, discoveryTimer: null, busy: false,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4200);
}
function errText(error) { return error?.shortMessage || error?.message || 'Something went wrong.'; }
function marketId(m) { return m?.marketId || m?.id; }
function marketPool(m) { return m?.pool || m?.poolAddress; }
function intervalLabel(m) {
  const s = Number(m?.intervalSec || 0);
  if (!s) return 'live round';
  if (s % 3600 === 0) return `${s / 3600}h`;
  return `${Math.round(s / 60)}m`;
}
function fillUnits(result) {
  return (result?.fills || []).reduce((sum, f) => sum + BigInt(f?.quantityFilled || 0), 0n);
}
function txHash(result) {
  const values = [result?.hash, result?.txHash, result?.receipt?.transactionHash, result?.info?.hash];
  return values.find((v) => typeof v === 'string' && /^0x[a-fA-F0-9]{64}$/.test(v)) || null;
}
function sharesText(raw) {
  return Number(formatUnits(BigInt(raw || 0), 6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}
function setBusy(value, message) {
  state.busy = value;
  $('#enterButton').disabled = value || !state.market;
  if (message) $('#status').textContent = message;
}

function setupWalletButton() {
  if (window.ethereum) {
    $('#walletLabel').textContent = state.wallet ? `${state.wallet.slice(0, 6)}…${state.wallet.slice(-4)}` : 'Connect wallet';
  } else {
    $('#walletLabel').textContent = 'Open in MetaMask';
    $('#status').textContent = 'Tap “Open in MetaMask” above. TAKE IT needs a wallet browser to sign the testnet trade.';
  }
}

async function ensureSomnia() {
  if (!window.ethereum) {
    window.location.href = `https://metamask.app.link/dapp/${SITE_HOST}`;
    throw new Error('Opening MetaMask…');
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
  return address;
}

async function verifyFunding(market) {
  const native = await exchange.client.getViemClient().getBalance({ address: state.wallet });
  if (native === 0n) throw new Error('This wallet has no STT for gas. Add Somnia Shannon test STT first.');
  const collateral = market?.collateral || SOMNIA_TESTNET_ADDRESSES.testUsdc;
  if (!collateral) return;
  const balance = await exchange.client.getErc20Balance(collateral, state.wallet);
  if (balance === 0n) throw new Error('This wallet has no DreamDEX test collateral (tUSDC). Fund the same wallet first.');
}

async function findForAsset(asset) {
  const listed = await exchange.client.listLiveBinaryMarkets({ asset, limit: 50 });
  const now = Math.floor(Date.now() / 1000);
  return (listed || [])
    .filter((m) => String(m.asset).toUpperCase() === asset && Number(m.expiry || 0) > now + 60 && marketPool(m))
    .sort((a, b) => Number(a.intervalSec || 999999) - Number(b.intervalSec || 999999) || Number(a.expiry) - Number(b.expiry))[0] || null;
}

async function discoverMarket() {
  if (state.position || state.busy) return;
  clearTimeout(state.discoveryTimer);
  $('#enterButton').disabled = true;
  $('#marketStatus').textContent = 'Reading DreamDEX live markets…';
  $('#marketQuestion').textContent = `Looking for an open ${state.asset} Event Contract…`;
  try {
    let chosen = await findForAsset(state.asset);
    if (!chosen) {
      const fallback = state.asset === 'BTC' ? 'ETH' : 'BTC';
      chosen = await findForAsset(fallback);
      if (chosen) {
        state.asset = fallback;
        $$('.asset-tab').forEach((b) => b.classList.toggle('selected', b.dataset.asset === fallback));
      }
    }
    if (!chosen) {
      state.market = null;
      $('#marketQuestion').textContent = 'Waiting for the next DreamDEX Event Contract.';
      $('#marketStatus').textContent = 'No open BTC or ETH round is listed right now. Retrying automatically.';
      $('#countdown').textContent = '--:--';
      state.discoveryTimer = setTimeout(discoverMarket, 6000);
      return;
    }

    state.market = chosen;
    $('#assetTitle').textContent = state.asset;
    $('#marketInterval').textContent = intervalLabel(chosen);
    $('#marketQuestion').textContent = chosen.question || `Will ${state.asset} finish this round higher than it started?`;
    $('#marketStatus').textContent = `DreamDEX live market found · ${intervalLabel(chosen)} round`;
    $('#enterButton').disabled = false;
    const addr = marketPool(chosen);
    if (addr) {
      $('#marketLink').href = `${EXPLORER}/address/${addr}`;
      $('#marketLink').hidden = false;
    }
    startClock(Number(chosen.expiry));
  } catch (e) {
    console.warn('DreamDEX discovery:', e);
    state.market = null;
    $('#marketQuestion').textContent = 'DreamDEX market feed is temporarily unavailable.';
    $('#marketStatus').textContent = 'Retrying automatically. You can still connect your wallet now.';
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
      if (state.position?.status === 'open') settlePosition(); else discoverMarket();
    }
  };
  render();
  state.clockTimer = setInterval(render, 1000);
}

async function enterPosition() {
  if (!state.market || state.busy) return;
  try {
    setBusy(true, 'Connect your wallet to continue.');
    await connectWallet();
    await verifyFunding(state.market);

    const shares = Math.max(0.1, Number($('#stake').value || 1));
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Enter a valid number of shares.');
    const quantity = BigInt(Math.round(shares * 1_000_000));
    const side = state.side === 'UP' ? 'BUY_YES' : 'BUY_NO';

    $('#status').textContent = `Buying ${shares} ${state.side} share${shares === 1 ? '' : 's'}. Approve the DreamDEX transaction in your wallet.`;
    const result = await exchange.trader.placeOrder({
      pool: marketPool(state.market),
      side,
      price: probabilityToPrice(0.99),
      quantity,
      orderType: 2,
    });

    const filled = fillUnits(result);
    if (filled <= 0n) throw new Error('DreamDEX returned no fill. No trade was made. Try the next round.');
    const hash = txHash(result);

    const position = {
      marketId: String(marketId(state.market)),
      pool: marketPool(state.market),
      asset: state.asset,
      side: state.side,
      wallet: state.wallet,
      expiry: Number(state.market.expiry),
      quantityUnits: filled.toString(),
      shares: sharesText(filled),
      entryTx: hash,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    state.position = position;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    showPosition();
    toast('Real DreamDEX position opened.');
  } catch (e) {
    console.error('Entry failed:', e);
    $('#status').textContent = errText(e);
    toast(errText(e));
  } finally {
    state.busy = false;
    $('#enterButton').disabled = !state.market;
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
  $('#entryValue').textContent = `${p.shares} shares`;
  $('#shareValue').textContent = p.shares;
  $('#payoutValue').textContent = `up to ${p.shares} tUSDC`;
  $('#offerValue').textContent = 'BEST BID';
  $('#offerSymbol').textContent = 'DreamDEX exit';
  $('#cashoutButton').disabled = false;
  $('#cashoutButton').textContent = 'TAKE THE BEST AVAILABLE BID';
  $('#positionStatus').textContent = 'You are holding a real DreamDEX outcome token. Cash out attempts to sell it immediately into the live book.';
  if (p.entryTx) {
    $('#entryTx').href = `${EXPLORER}/tx/${p.entryTx}`;
    $('#entryTx').hidden = false;
  }
  startClock(p.expiry);
}

async function cashOut() {
  const p = state.position;
  if (!p || p.status !== 'open' || state.busy) return;
  try {
    state.busy = true;
    $('#cashoutButton').disabled = true;
    await connectWallet();
    if (state.wallet.toLowerCase() !== p.wallet.toLowerCase()) throw new Error('Connect the same wallet that opened this position.');

    const side = p.side === 'UP' ? 'SELL_YES' : 'SELL_NO';
    $('#positionStatus').textContent = 'Trying to sell your position into the best available DreamDEX bid. Approve in your wallet.';
    const result = await exchange.trader.placeOrder({
      pool: p.pool,
      side,
      price: probabilityToPrice(0.01),
      quantity: BigInt(p.quantityUnits),
      orderType: 2,
    });

    const filled = fillUnits(result);
    if (filled <= 0n) throw new Error('No buyer filled the cash-out. Your position is still yours.');
    const hash = txHash(result);
    const remaining = BigInt(p.quantityUnits) - filled;
    p.quantityUnits = remaining > 0n ? remaining.toString() : '0';
    p.status = remaining > 0n ? 'partial' : 'closed';
    p.exitTx = hash;
    p.exitFilled = sharesText(filled);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));

    if (remaining > 0n) {
      p.shares = sharesText(remaining);
      state.position = p;
      showPosition();
      $('#positionStatus').textContent = `DreamDEX sold ${p.exitFilled} shares. ${p.shares} shares remain.`;
      toast('Partial cash-out filled.');
    } else {
      showResult('DEAL TAKEN', `DreamDEX sold your ${p.side} position onchain. ${p.exitFilled} shares filled.`, hash);
      toast('Cash-out filled onchain.');
    }
  } catch (e) {
    console.error('Cash-out failed:', e);
    $('#positionStatus').textContent = errText(e);
    toast(errText(e));
  } finally {
    state.busy = false;
    if (state.position?.status === 'open' || state.position?.status === 'partial') $('#cashoutButton').disabled = false;
  }
}

function showResult(title, copy, hash) {
  $('#setupView').hidden = true;
  $('#positionView').hidden = true;
  $('#resultView').hidden = false;
  $('#resultTitle').textContent = title;
  $('#resultCopy').textContent = copy;
  $('#resultProof').innerHTML = hash ? `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">View Somnia transaction ↗</a>` : 'DreamDEX settlement determines the final result.';
}

async function settlePosition() {
  const p = state.position;
  if (!p || !['open', 'partial'].includes(p.status)) return;
  $('#positionStatus').textContent = 'Round ended. Waiting for DreamDEX settlement…';
  try {
    const m = await exchange.client.getMarketOnchain(p.marketId);
    if (!m?.finalized && !m?.isResolved && !m?.isVoided) {
      setTimeout(settlePosition, 8000);
      return;
    }
    const idx = p.side === 'UP' ? 0 : 1;
    if (!m.isVoided && Number(m.winningOutcome) !== idx) {
      p.status = 'lost';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      showResult('ROUND LOST', `You held ${p.side}. DreamDEX settled the other side.`, null);
      return;
    }
    showResult('YOU HELD IT', `Your ${p.side} position won. Claim it from the same wallet.`, null);
    $('#claimButton').hidden = false;
  } catch (e) {
    console.warn('Settlement check:', e);
    $('#positionStatus').textContent = 'DreamDEX settlement RPC is slow. The position remains safe in your wallet.';
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
    const hash = txHash(result);
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

function restorePosition() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!saved || ['closed', 'claimed', 'lost'].includes(saved.status)) return false;
  state.position = saved;
  state.asset = saved.asset;
  state.side = saved.side;
  showPosition();
  return true;
}

function resetRound() {
  localStorage.removeItem(STORAGE_KEY);
  state.position = null;
  state.market = null;
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
  try { await connectWallet(); toast('Wallet connected.'); }
  catch (e) { toast(errText(e)); }
});
$('#enterButton').addEventListener('click', enterPosition);
$('#cashoutButton').addEventListener('click', cashOut);
$('#holdButton').addEventListener('click', () => toast('Holding until DreamDEX settles the round.'));
$('#claimButton').addEventListener('click', claim);
$('#newRoundButton').addEventListener('click', resetRound);

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', () => {
    state.wallet = null;
    state.walletClient = null;
    setupWalletButton();
  });
}

setupWalletButton();
if (!restorePosition()) discoverMarket();