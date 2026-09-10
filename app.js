(() => {
  const state = { intent: 'buy', asset: 'ETH', amount: '100', currency: 'USD', minutes: '15', wallet: null };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const toast = $('#toast');

  function contractSide() { return `${state.asset} ${state.intent === 'buy' ? 'Up' : 'Down'}`; }
  function updatePreview() {
    const rising = state.intent === 'buy';
    $('#previewAsset').textContent = state.asset;
    $('#previewAssetIcon').textContent = state.asset === 'ETH' ? 'Ξ' : '₿';
    $('#previewAssetIcon').className = `token-icon ${state.asset.toLowerCase()}`;
    $('#previewWindow').textContent = `${state.minutes} minute window`;
    $('#previewTitle').textContent = rising ? 'Buying later means a price rise is the risk.' : 'Selling later means a price fall is the risk.';
    $('#previewDescription').textContent = rising ? `A small ${state.asset} Up Event Contract can help if ${state.asset} rises before you buy.` : `A small ${state.asset} Down Event Contract can help if ${state.asset} falls before you sell.`;
    $('#previewSide').textContent = contractSide();
    $('#previewExplanation').textContent = rising ? `${state.asset} rising makes your future purchase more expensive.` : `${state.asset} falling makes your future sale worth less.`;
  }
  function createReceipt() {
    $('#receiptAction').textContent = `${state.intent === 'buy' ? 'Buying' : 'Selling'} ${state.asset} later`;
    $('#receiptRisk').textContent = `Protected if ${state.asset} ${state.intent === 'buy' ? 'rises' : 'falls'}`;
    $('#receiptAmount').textContent = `Plan: ${state.amount} ${state.currency} · ${state.minutes} minutes`;
    $('#receiptSide').textContent = contractSide();
    $('#receiptStatus').textContent = 'Demo plan created. Use the onchain companion for a real testnet order.';
    $('#receiptCard').classList.remove('receipt-updated');
    requestAnimationFrame(() => $('#receiptCard').classList.add('receipt-updated'));
    localStorage.setItem('delayguard-plan-v1', JSON.stringify({ ...state, createdAt: new Date().toISOString() }));
    location.hash = 'receipt';
    showToast('Your demo protection receipt is ready.');
  }
  function showToast(message) { toast.textContent = message; toast.classList.add('show'); window.setTimeout(() => toast.classList.remove('show'), 3800); }

  $$('.choice').forEach((button) => button.addEventListener('click', () => { state.intent = button.dataset.intent; $$('.choice').forEach((item) => item.classList.toggle('selected', item === button)); updatePreview(); }));
  $$('.time-choice').forEach((button) => button.addEventListener('click', () => { state.minutes = button.dataset.time; $$('.time-choice').forEach((item) => item.classList.toggle('selected', item === button)); updatePreview(); }));
  $('#asset').addEventListener('change', (event) => { state.asset = event.target.value; updatePreview(); });
  $('#amount').addEventListener('input', (event) => { state.amount = event.target.value.replace(/[^0-9.]/g, '').slice(0, 10) || '0'; });
  $('#currency').addEventListener('change', (event) => { state.currency = event.target.value; });
  $('#protectionForm').addEventListener('submit', (event) => { event.preventDefault(); if (Number(state.amount) <= 0) { showToast('Enter an amount bigger than zero.'); $('#amount').focus(); return; } createReceipt(); });

  $('#walletButton').addEventListener('click', async () => {
    if (!window.ethereum) { showToast('No browser wallet found. Open this in MetaMask, Rabby, or another wallet browser.'); return; }
    try { const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' }); state.wallet = address; $('#walletLabel').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`; $('#walletButton').classList.add('connected'); showToast('Wallet connected. Your private key stays in your wallet.'); }
    catch { showToast('Wallet connection was cancelled.'); }
  });

  const saved = localStorage.getItem('delayguard-plan-v1');
  if (saved) { try { Object.assign(state, JSON.parse(saved)); $('#asset').value = state.asset; $('#amount').value = state.amount; $('#currency').value = state.currency; $$('.choice').forEach((item) => item.classList.toggle('selected', item.dataset.intent === state.intent)); $$('.time-choice').forEach((item) => item.classList.toggle('selected', item.dataset.time === state.minutes)); updatePreview(); createReceipt(); } catch {} }
  updatePreview();
})();

