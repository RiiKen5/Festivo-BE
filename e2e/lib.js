const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true });
const APP = process.env.APP || 'http://localhost:4200';
const API = process.env.API || 'http://localhost:5000/api/v1';

// Stand-in for Razorpay Checkout: "pays" instantly, signing with the local test secret
const FAKE_CHECKOUT = `
window.Razorpay = function (opts) {
  this.opts = opts; this.handlers = {};
  this.on = (ev, fn) => { this.handlers[ev] = fn; };
  this.open = async () => {
    window.__lastCheckout = { amount: opts.amount, order: opts.order_id, description: opts.description };
    if (window.__dismissCheckout) { opts.modal && opts.modal.ondismiss && opts.modal.ondismiss(); return; }
    const paymentId = 'pay_e2e' + Date.now();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('e2e_secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(opts.order_id + '|' + paymentId));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    opts.handler({ razorpay_order_id: opts.order_id, razorpay_payment_id: paymentId, razorpay_signature: hex });
  };
};`;

async function session(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://checkout.razorpay.com/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_CHECKOUT }));
  // Google sign-in script isn't needed locally
  await context.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push(`[${label}] console: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => issues.push(`[${label}] PAGE ERROR: ${e.message.slice(0, 300)}`));
  page.on('response', async r => {
    if (r.url().startsWith(API) && r.status() >= 400) {
      let body = ''; try { body = (await r.text()).slice(0, 200); } catch {}
      issues.push(`[${label}] ${r.request().method()} ${r.url().replace(API, '')} -> ${r.status()} ${body}`);
    }
  });
  return { context, page, issues };
}

async function login(page, email, password = 'Password123!') {
  await page.goto(APP + '/auth/login');
  await page.locator('app-input[formcontrolname=email] input').fill(email);
  await page.locator('app-input[formcontrolname=password] input').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(u => !u.pathname.startsWith('/auth/login'), { timeout: 10000 });
  await settle(page);
}

// City fields are searchable dropdowns: type, then pick the first match
async function pickCity(page, city, scope = '[formcontrolname=city]') {
  const input = page.locator(`app-city-select${scope} input`);
  await input.fill(city);
  await input.press('Enter');
}

async function settle(page, ms = 600) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return r.json();
}

async function tokenFor(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: 'Password123!' } });
  return r.data.tokens.accessToken;
}

module.exports = { chromium, APP, API, session, login, settle, api, tokenFor, pickCity };
