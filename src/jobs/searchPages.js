const seoService = require('../services/seoService');

const run = async () => {
  try {
    const { rebuilt, notified } = await seoService.refreshSearchPages();
    if (rebuilt) console.log('[seo] listings changed, frontend rebuild requested');
    if (notified) console.log(`[seo] ${notified} URL(s) sent to IndexNow`);
  } catch (error) {
    console.error('[seo] failed:', error.message);
  }
};

// Shortly after boot, then hourly
const start = () => {
  setTimeout(run, 60 * 1000).unref();
  return setInterval(run, 60 * 60 * 1000).unref();
};

module.exports = { start };
