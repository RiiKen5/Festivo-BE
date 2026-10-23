const { chromium, APP, api, login, settle } = require('./lib');
(async () => {
  const events = (await api('/events')).data, services = (await api('/services')).data;
  const browser = await chromium.launch();
  for (const who of ['rohit@test.in', 'admin@test.in']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await login(page, who);
    const routes = ['/', '/events', `/events/${events[0].slug}`, '/services', `/services/${services[0].slug}`, '/dashboard', '/bookings', '/messages', '/notifications', '/profile', '/events/create', '/dashboard/earnings', '/terms', '/admin'];
    for (const r of routes) {
      await page.goto(APP + r); await settle(page, 400);
      const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
      const tag = who.split('@')[0] + r.replace(/\//g, '_');
      if (sw > w + 1) {
        const culprit = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).join(' | '));
        console.log(`OVERFLOW ${tag}: ${sw}px > ${w}px  ${culprit}`);
        await page.screenshot({ path: `shots/M${tag}.png` });
      }
    }
    await page.goto(APP + `/events/${events[0].slug}`); await settle(page); await page.screenshot({ path: 'shots/M_event.png', fullPage: false });
    await ctx.close();
  }
  await browser.close(); console.log('done');
})();
