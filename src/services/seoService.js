const axios = require('axios');
const Service = require('../models/Service');
const Event = require('../models/Event');
const SiteState = require('../models/SiteState');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LIMIT = 5000;
// The frontend rebuild bakes listings into crawlable pages and the sitemap.
// At most four rebuilds a day keeps us well inside Render's build minutes.
const MIN_REBUILD_GAP = 6 * HOUR;
// Tell search engines only once the rebuilt pages are live
const BUILD_TIME = 20 * 60 * 1000;
const STATE_KEY = 'searchPages';
const INDEXNOW_URL = 'https://api.indexnow.org/indexnow';

const siteUrl = () => (process.env.SITE_URL || 'https://festivo.paathly.in').replace(/\/$/, '');

// Public events stay listed until the day after they happen
const publicEventQuery = (now) => ({
  isPublic: true,
  isPublished: true,
  status: { $ne: 'cancelled' },
  date: { $gte: new Date(now - DAY) }
});

/**
 * Everything a search engine may index, with the fields the frontend build
 * needs to write each page's title, description, preview image and JSON-LD.
 * Only what the public pages already show; never private events.
 */
const publicPages = async (now = new Date()) => {
  const [services, events] = await Promise.all([
    Service.find({ isActive: true })
      .select('serviceName slug category description basePrice priceUnit city serviceAreas coverImage portfolioImages ratingAverage totalRatings updatedAt provider')
      .populate('provider', 'name')
      .sort({ updatedAt: -1 })
      .limit(LIMIT)
      .lean(),
    Event.find(publicEventQuery(now))
      .select('title slug description eventType date time endDate locationName address city coverPhoto entryFee isPaid updatedAt organizer')
      .populate('organizer', 'name')
      .sort({ date: 1 })
      .limit(LIMIT)
      .lean()
  ]);

  return {
    services: services.map(s => ({
      slug: s.slug,
      name: s.serviceName,
      category: s.category,
      description: s.description,
      price: s.basePrice,
      priceUnit: s.priceUnit,
      city: s.city,
      areas: s.serviceAreas || [],
      image: s.coverImage || s.portfolioImages?.[0] || null,
      rating: s.totalRatings > 0 ? { average: s.ratingAverage, count: s.totalRatings } : null,
      provider: s.provider?.name || null,
      updatedAt: s.updatedAt
    })),
    events: events.map(e => ({
      slug: e.slug,
      title: e.title,
      description: e.description,
      eventType: e.eventType,
      date: e.date,
      time: e.time || null,
      endDate: e.endDate || null,
      venue: e.locationName,
      address: e.address,
      city: e.city,
      image: e.coverPhoto || null,
      price: e.isPaid ? e.entryFee : 0,
      organizer: e.organizer?.name || null,
      updatedAt: e.updatedAt
    }))
  };
};

// Listings created, edited or taken down since the last rebuild
const changedPaths = async (since) => {
  const [services, events] = await Promise.all([
    Service.find({ updatedAt: { $gt: since } }).select('slug').lean(),
    // Only events that are (or were made) public; never advertise a private one
    Event.find({ updatedAt: { $gt: since }, isPublic: true }).select('slug').lean()
  ]);
  return [
    ...services.map(s => `/services/${s.slug}`),
    ...events.map(e => `/events/${e.slug}`)
  ];
};

// IndexNow (Bing, Yandex, Seznam, Naver): one POST for up to 10,000 URLs.
// The key is public by design; it must also be served at /<key>.txt.
const notifyIndexNow = async (paths) => {
  const key = process.env.INDEXNOW_KEY;
  if (!key || !paths.length) return false;
  const site = siteUrl();
  await axios.post(INDEXNOW_URL, {
    host: new URL(site).host,
    key,
    keyLocation: `${site}/${key}.txt`,
    urlList: paths.slice(0, 10000).map(p => `${site}${p}`)
  }, { timeout: 15000 });
  return true;
};

/**
 * Hourly: when listings changed, rebuild the frontend (Render deploy hook) so
 * the new pages are crawlable and in the sitemap; once that build has had
 * time to go live, ping IndexNow with the changed URLs.
 */
const refreshSearchPages = async (now = new Date()) => {
  const hook = process.env.FRONTEND_DEPLOY_HOOK_URL;
  if (!hook) return { rebuilt: false, notified: 0 };

  let state = await SiteState.findOne({ key: STATE_KEY });
  if (!state) {
    // First run: start counting changes from now rather than rebuilding for history
    await SiteState.create({ key: STATE_KEY, value: { lastBuildAt: now, pending: [] } });
    return { rebuilt: false, notified: 0 };
  }
  const { lastBuildAt, pending = [] } = state.value;
  const value = { lastBuildAt: new Date(lastBuildAt), pending };
  let notified = 0;

  if (pending.length && now - value.lastBuildAt >= BUILD_TIME) {
    try {
      if (await notifyIndexNow(pending)) notified = pending.length;
      value.pending = [];
    } catch (error) {
      // Keep them for the next hour
      console.error('[seo] IndexNow failed:', error.message);
    }
  }

  let rebuilt = false;
  if (now - value.lastBuildAt >= MIN_REBUILD_GAP) {
    const changed = await changedPaths(value.lastBuildAt);
    if (changed.length) {
      await axios.post(hook, null, { timeout: 15000 });
      value.lastBuildAt = now;
      value.pending = [...new Set([...value.pending, ...changed])];
      rebuilt = true;
    }
  }

  state.value = value;
  state.markModified('value');
  await state.save();
  return { rebuilt, notified };
};

module.exports = { publicPages, changedPaths, notifyIndexNow, refreshSearchPages, MIN_REBUILD_GAP, BUILD_TIME };
