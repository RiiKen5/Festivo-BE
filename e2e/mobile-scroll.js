// Phones: find anything that scrolls sideways or sticks out of the screen, on
// every page for every role, at small and common phone widths
const { chromium, APP, api, login, settle } = require('./lib');
const WIDTHS = (process.env.WIDTHS || '320,360,390').split(',').map(Number);

(async () => {
  const events = (await api('/events')).data, services = (await api('/services')).data;
  const pub = ['/', '/events', `/events/${events[0].slug}`, `/events/${events.find(e => e.entryFee)?.slug || events[1].slug}`,
    '/services', `/services/${services[0].slug}`, '/for-vendors', '/contact', '/terms', '/privacy', '/refund-policy'];
  const auth = ['/auth/login', '/auth/register', '/auth/forgot-password'];
  const app = ['/dashboard', '/dashboard/events', '/dashboard/bookings', '/dashboard/my-services', '/dashboard/earnings',
    '/dashboard/calendar', '/dashboard/find-events', '/bookings', '/messages', '/notifications', '/profile',
    '/events/create', '/services/create', '/admin'];
  const roles = [[null, [...pub, ...auth]], ['rohit@test.in', app], ['priya@test.in', app], ['asha@test.in', app], ['admin@test.in', ['/admin', '/dashboard']]];
  const browser = await chromium.launch();
  const found = new Map();
  for (const width of WIDTHS) {
    for (const [who, routes] of roles) {
      const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await ctx.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
      const page = await ctx.newPage();
      if (who) await login(page, who);
      for (const r of routes) {
        await page.goto(APP + r); await settle(page, 500);
        const res = await page.evaluate((W) => {
          const out = [];
          const name = e => e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].join('.') : '') +
            (e.closest('[_nghost-ng-c0],[class]') ? '' : '');
          const host = e => { for (let p = e; p; p = p.parentElement) if (p.tagName.includes('-') && p.tagName !== 'APP-ROOT') return p.tagName.toLowerCase(); return ''; };
          const doc = document.documentElement.scrollWidth;
          if (doc > W + 1) out.push(`PAGE ${doc}px`);
          for (const e of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
              out.push(`SCROLLS ${host(e)} ${name(e)} (${e.scrollWidth}>${e.clientWidth})`);
          }
          // Deepest elements sticking out past the right edge (not inside a scroller, not fixed off-canvas)
          const stick = [...document.querySelectorAll('body *')].filter(e => {
            const b = e.getBoundingClientRect();
            if (b.width === 0 || b.right <= W + 1 || b.left >= W) return false;
            for (let p = e.parentElement; p; p = p.parentElement) {
              const s = getComputedStyle(p);
              if (/(auto|scroll)/.test(s.overflowX) && p !== document.body && p !== document.documentElement) return false;
            }
            return ![...e.children].some(c => c.getBoundingClientRect().right > W + 1);
          }).slice(0, 4);
          stick.forEach(e => out.push(`STICKS ${host(e)} ${name(e)} right=${Math.round(e.getBoundingClientRect().right)}`));
          return out;
        }, width);
        for (const line of res) {
          const key = line.replace(/\(\d+>\d+\)|right=\d+|\d+px/g, '').trim() + ' @ ' + r;
          if (!found.has(key)) found.set(key, []);
          found.get(key).push(`${width}${who ? ' ' + who.split('@')[0] : ''}`);
        }
        if (res.length && process.env.SHOTS) await page.screenshot({ path: `shots/X${width}${r.replace(/\//g, '_')}.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
  await browser.close();
  for (const [k, v] of found) console.log(k, ' [' + [...new Set(v)].join(', ') + ']');
  console.log(found.size ? `${found.size} problems` : 'NO SIDEWAYS SCROLL');
})();
