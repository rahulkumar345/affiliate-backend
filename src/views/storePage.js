// Acme Store — a tiny demo merchant so the referral loop is demonstrable
// end-to-end without a real e-commerce integration. Checkout calls the same
// conversion service the production webhook uses.

export const PRODUCTS_MAP = {
  'aurora-headphones': { name: 'Aurora Wireless Headphones', priceCents: 12900, emoji: '🎧' },
  'terra-smartwatch': { name: 'Terra Smartwatch', priceCents: 19900, emoji: '⌚' },
  'flux-charger': { name: 'Flux 3-in-1 Charger', priceCents: 5900, emoji: '🔌' },
};

export function storePageHtml(refCode) {
  const safeRef = refCode ? String(refCode).replace(/[^A-Z0-9]/gi, '').toUpperCase() : null;

  const productCardsHtml = Object.entries(PRODUCTS_MAP)
    .map(
      ([id, product]) => `
      <div class="card">
        <div class="thumb">${product.emoji}</div>
        <h3>${product.name}</h3>
        <p class="price">$${(product.priceCents / 100).toFixed(2)}</p>
        <button class="buy" data-product="${id}">Buy now</button>
      </div>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acme Store</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #0f172a; }
  header { background: #0f172a; color: #fff; padding: 18px 24px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 20px; }
  header span { font-size: 12px; color: #94a3b8; }
  .ref-banner { background: #eef2ff; border-bottom: 1px solid #c7d2fe; color: #3730a3; padding: 10px 24px; font-size: 14px; }
  .ref-banner b { letter-spacing: 1px; }
  main { max-width: 860px; margin: 32px auto; padding: 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; }
  .thumb { font-size: 56px; padding: 18px 0; }
  .card h3 { font-size: 15px; margin-bottom: 6px; }
  .price { color: #475569; margin-bottom: 14px; }
  .buy { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer; width: 100%; }
  .buy:disabled { background: #16a34a; cursor: default; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #0f172a; color: #fff;
           padding: 12px 20px; border-radius: 10px; font-size: 14px; display: none; max-width: 90vw; }
  footer { text-align: center; color: #94a3b8; font-size: 12px; padding: 32px 16px; }
</style>
</head>
<body>
  <header><h1>Acme Store</h1><span>demo merchant for the Amplify affiliate program</span></header>
  ${safeRef ? `<div class="ref-banner">You arrived via referral code <b>${safeRef}</b> — your purchase supports this partner.</div>` : ''}
  <main><div class="grid">${productCardsHtml}</div></main>
  <footer>Every purchase here fires the same conversion webhook a real store would call.</footer>
  <div id="toast"></div>
<script>
  const REF_CODE = ${safeRef ? `'${safeRef}'` : 'null'};
  const toast = document.getElementById('toast');

  function showToast(message) {
    toast.textContent = message;
    toast.style.display = 'block';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.style.display = 'none'; }, 5000);
  }

  document.querySelectorAll('.buy').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Placing order…';
      try {
        const response = await fetch('/api/store/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: button.dataset.product, refCode: REF_CODE }),
        });
        const dataMap = await response.json();
        if (!response.ok) throw new Error(dataMap.error || 'Checkout failed');
        button.textContent = '✓ Ordered';
        showToast(dataMap.commissionRecorded
          ? 'Order ' + dataMap.orderId + ' placed — commission recorded for ' + REF_CODE + ' ✓'
          : 'Order ' + dataMap.orderId + ' placed (no referral attached)');
      } catch (err) {
        button.disabled = false;
        button.textContent = 'Buy now';
        showToast('Error: ' + err.message);
      }
    });
  });
</script>
</body>
</html>`;
}
