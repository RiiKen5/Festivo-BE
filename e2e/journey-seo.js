// Search engines and link previews. Part 1 reads the built site the way a
// crawler without JavaScript does (served like Render: a real file first,
// otherwise index.html). Part 2 checks the tags the app sets in the browser,
// and that no internal link on a public page leads to "page not found".
// Needs a production build first: (cd ../../frontend && npm run build)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, APP, API, session, login, settle, api, tokenFor } = require('./lib');

const FRONTEND = path.join(__dirname, '../../frontend');
const DIST = path.join(FRONTEND, 'dist/frontend/browser');
const SITE = 'https://yaay.paathly.in';
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };

// Render's static hosting: an existing file wins over the "/* -> /index.html"
// rewrite, and a folder's index.html is served only at "/folder/"
const TYPES = { '.html': 'text/html', '.xml': 'application/xml', '.txt': 'text/plain', '.js': 'text/javascript', '.css': 'text/css' };
const serve = () => http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const candidates = url.endsWith('/') ? [path.join(DIST, url, 'index.html')] : [path.join(DIST, url)];
  const file = candidates.find(f => f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) || path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(4300);

const get = async (p) => (await fetch('http://localhost:4300' + p)).text();
const tag = (html, re) => html.match(re)?.[1];
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json" data-seo="page">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('FAIL no production build; run `npm run build` in frontend first');
    process.exit(1);
  }
  const vendor = (await api('/services?search=Designer')).data[0];
  const events = (await api('/events')).data;
  const publicEvent = events.find(e => e.title === 'Sunset Rooftop Party');
  const orgToken = await tokenFor('rohit@test.in');
  const privateEvent = (await api('/events/my-events?limit=50', { token: orgToken })).data.find(e => e.title === "Rohit's 30th Birthday");
  check(vendor && publicEvent && privateEvent, 'seeded vendor, public event and private event');

  // Pre-render against this test API, then check the result
  const out = execFileSync('node', ['scripts/seo-build.mjs'], { cwd: FRONTEND, env: { ...process.env, SEO_API_URL: API } }).toString();
  check(/\d+ vendors, \d+ events/.test(out) && !/WARNING/.test(out), `pre-render read the listings (${out.trim()})`);
  execFileSync('node', ['scripts/seo-check.mjs'], { cwd: FRONTEND, stdio: 'inherit' });
  check(true, 'seo-check passes on the full build');
  const server = serve();

  // 1. What crawlers and link previews see without JavaScript
  const vendorHtml = await get(`/services/${vendor.slug}/`);
  check(tag(vendorHtml, /<title>([^<]*)</) === `${vendor.serviceName} · Food &amp; cakes in ${vendor.city} · Yaay`, 'vendor page has its own title');
  check(tag(vendorHtml, /rel="canonical" href="([^"]*)"/) === `${SITE}/services/${vendor.slug}/`, 'vendor page canonical URL (trailing slash, the form Render serves)');
  check(/^https:\/\//.test(tag(vendorHtml, /og:image" content="([^"]*)"/) || ''), 'vendor preview image is an absolute URL');
  const service = ld(vendorHtml)[0]['@graph'];
  check(service[0]['@type'] === 'Service' && service[0].offers.priceSpecification.price === vendor.basePrice && service[0].offers.priceSpecification.priceCurrency === 'INR', 'vendor structured data: Service with the real price');
  check(service[1]['@type'] === 'BreadcrumbList' && service[1].itemListElement.length === 3, 'vendor breadcrumbs');
  check(/<script src="main-[^"]+\.js"/.test(vendorHtml), 'vendor page still boots the app');

  const eventHtml = await get(`/events/${publicEvent.slug}/`);
  const ev = ld(eventHtml)[0]['@graph'][0];
  check(ev['@type'] === 'Event' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+05:30$/.test(ev.startDate) && ev.offers.price === 499 && ev.location.address.addressLocality, `public event structured data (${ev.startDate}, ₹${ev.offers.price})`);

  const privateHtml = await get(`/events/${privateEvent.slug}/`);
  check(!privateHtml.includes(privateEvent.title) && !/rel="canonical"/.test(privateHtml) && ld(privateHtml).length === 0, 'private event: no page of its own, nothing about it in the HTML');

  const sitemap = await get('/sitemap.xml');
  check(sitemap.includes(`${SITE}/services/${vendor.slug}/</loc><lastmod>`), 'sitemap lists the vendor with its last change');
  check(sitemap.includes(`${SITE}/events/${publicEvent.slug}/<`) && !sitemap.includes(privateEvent.slug), 'sitemap has the public event, not the private one');
  check(!/\/(auth|dashboard|admin|delete-account)/.test(sitemap), 'sitemap leaves out private and account pages');
  const robots = await get('/robots.txt');
  check(robots.includes(`Sitemap: ${SITE}/sitemap.xml`) && robots.includes('Disallow: /dashboard'), 'robots.txt');
  server.close();

  // 2. Tags the app sets in the browser
  const browser = await chromium.launch();
  const { page, issues } = await session(browser, 'seo');
  const head = () => page.evaluate(() => ({
    title: document.title,
    robots: document.querySelector('meta[name=robots]')?.content,
    canonical: document.querySelector('link[rel=canonical]')?.href,
    description: document.querySelector('meta[name=description]')?.content
  }));

  await page.goto(`${APP}/services/${vendor.slug}`); await settle(page);
  let h = await head();
  check(h.title.startsWith(vendor.serviceName) && h.canonical === `${SITE}/services/${vendor.slug}/` && h.robots.startsWith('index'), 'vendor page in the browser: title, canonical, indexable');
  await page.goto(`${APP}/services/${vendor.slug}/`); await settle(page);
  check(await page.getByRole('heading', { level: 1, name: vendor.serviceName }).isVisible(), 'the slash form of a vendor URL opens the vendor page');

  await page.goto(`${APP}/services?category=food&q=cake`); await settle(page);
  h = await head();
  check(h.canonical === `${SITE}/services/` && h.title.startsWith('Event vendors near you'), 'filtered vendor list points to the main list');

  await page.goto(`${APP}/no-such-page`); await settle(page);
  h = await head();
  check(h.title === 'Page not found · Yaay' && h.robots === 'noindex' && !h.canonical, 'unknown page: noindex, no canonical');

  await login(page, 'rohit@test.in');
  await page.goto(`${APP}/events/${privateEvent.slug}`); await settle(page);
  h = await head();
  check(h.robots === 'noindex' && !h.canonical, 'private event is never indexable, even for its organizer');
  await page.goto(`${APP}/dashboard`); await settle(page);
  check((await head()).robots === 'noindex', 'dashboard is noindex');

  // Every internal link on the public pages leads somewhere real
  const { page: guest } = await session(browser, 'crawl');
  const start = ['/', '/services', '/events', '/for-vendors', '/terms', '/privacy', '/refund-policy', '/contact', `/services/${vendor.slug}`, `/events/${publicEvent.slug}`];
  const links = new Set();
  for (const p of start) {
    await guest.goto(APP + p); await settle(guest, 300);
    const hrefs = await guest.$$eval('a[href^="/"]', as => as.map(a => a.getAttribute('href').split(/[?#]/)[0]));
    hrefs.filter(href => !/^\/(dashboard|bookings|messages|notifications|profile|admin|auth)/.test(href)).forEach(href => links.add(href));
  }
  const broken = [];
  for (const href of links) {
    await guest.goto(APP + href); await settle(guest, 200);
    if (await guest.locator('app-not-found').count()) broken.push(href);
  }
  check(broken.length === 0, `${links.size} internal links on public pages, none broken${broken.length ? ': ' + broken.join(', ') : ''}`);

  await browser.close();
  issues.forEach(x => console.log('ISSUE', x));
  if (issues.length) process.exitCode = 1;
})();
