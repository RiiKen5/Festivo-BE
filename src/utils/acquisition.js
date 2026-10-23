// Clean the first-touch attribution the browser sends at signup.
// Only known keys, short strings, and a plausible timestamp are kept.
const TEXT_FIELDS = ['source', 'medium', 'campaign', 'content', 'term', 'ref'];
const URL_FIELDS = ['referrer', 'landingPage'];

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';

exports.sanitizeAcquisition = (input, signupMethod) => {
  const out = { signupMethod };
  if (input && typeof input === 'object') {
    for (const key of TEXT_FIELDS) {
      const v = clean(input[key], 100).toLowerCase();
      if (v) out[key] = v;
    }
    for (const key of URL_FIELDS) {
      const v = clean(input[key], 300);
      if (v) out[key] = v;
    }
    const seen = new Date(input.firstSeenAt);
    const now = Date.now();
    if (!isNaN(seen) && seen.getTime() <= now && seen.getTime() > now - 180 * 24 * 60 * 60 * 1000) {
      out.firstSeenAt = seen;
    }
  }
  if (!out.source) out.source = out.referrer ? 'referral' : 'direct';
  return out;
};
