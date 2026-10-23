// Automated accessibility scan (axe-core, WCAG 2 A/AA) of key pages
const { chromium, APP, api, login, settle } = require('./lib');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
  const events = (await api('/events')).data, services = (await api('/services')).data;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pages = { public: ['/', '/events', `/events/${events[0].slug}`, '/services', `/services/${services[0].slug}`, '/auth/login', '/auth/register', '/terms'],
                  private: ['/dashboard', '/bookings', '/messages', '/notifications', '/profile', '/events/create', '/services/create', '/dashboard/earnings', '/admin'] };
  const totals = {};
  const scan = async (r) => {
    await page.goto(APP + r); await settle(page, 600);
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of res.violations) {
      totals[v.id] = totals[v.id] || { impact: v.impact, help: v.help, pages: new Set(), sample: v.nodes[0]?.target?.join(' ') };
      totals[v.id].pages.add(r);
    }
  };
  for (const r of pages.public) await scan(r);
  await login(page, 'admin@test.in');
  for (const r of pages.private) await scan(r);
  await browser.close();
  const rows = Object.entries(totals);
  if (!rows.length) return console.log('No WCAG A/AA violations found');
  for (const [id, v] of rows) console.log(`${v.impact.toUpperCase()} ${id}: ${v.help}\n   pages: ${[...v.pages].join(', ')}\n   e.g. ${v.sample}`);
})();
