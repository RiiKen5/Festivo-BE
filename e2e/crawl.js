// Visit every page as each role and report API failures and JS errors
const { chromium, APP, session, login, settle, api } = require('./lib');
const routes = (slugs) => ['/', '/events', `/events/${slugs.public}`, `/events/${slugs.paid}`, '/services', `/services/${slugs.service}`,
  '/dashboard', '/dashboard/events', '/dashboard/bookings', '/dashboard/my-services', '/dashboard/earnings',
  '/bookings', '/messages', '/notifications', '/profile', '/events/create', '/services/create', '/admin'];

(async () => {
  const events = (await api('/events')).data;
  const services = (await api('/services')).data;
  const slugs = { public: events.find(e => !e.entryFee).slug, paid: events.find(e => e.entryFee).slug, service: services[0].slug };
  const browser = await chromium.launch();
  const all = [];
  for (const who of [null, 'rohit@test.in', 'priya@test.in', 'asha@test.in', 'admin@test.in']) {
    const label = who ? who.split('@')[0] : 'anon';
    const { page, issues, context } = await session(browser, label);
    if (who) await login(page, who);
    for (const r of routes(slugs)) {
      await page.goto(APP + r); await settle(page);
      const finalPath = new URL(page.url()).pathname;
      const shot = `shots/${label}${r.replace(/\//g, '_') || '_home'}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      if (finalPath !== r) issues.push(`[${label}] ${r} redirected to ${finalPath}`);
    }
    all.push(...issues); await context.close();
  }
  await browser.close();
  console.log([...new Set(all)].join('\n') || 'NO ISSUES');
})();
