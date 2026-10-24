const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Booking = require('../../src/models/Booking');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');
const { sanitizeAcquisition } = require('../../src/utils/acquisition');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

describe('signup attribution', () => {
  it('stores where a new user came from', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'baker@example.com', password: 'Password123', phone: '9876543210', name: 'Baker', city: 'Pune',
      acquisition: { source: 'Instagram', medium: 'bio', campaign: 'vendors-oct', landingPage: '/for-vendors', junk: 'x' }
    });
    expect(res.status).toBe(201);
    const user = await User.findOne({ email: 'baker@example.com' }).select('+acquisition').lean();
    expect(user.acquisition).toMatchObject({ source: 'instagram', medium: 'bio', campaign: 'vendors-oct', landingPage: '/for-vendors', signupMethod: 'email' });
    expect(user.acquisition.junk).toBeUndefined();
  });

  it('is not exposed on public profile reads', async () => {
    const { user, token } = await createUser({ acquisition: { source: 'invite' } });
    const res = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('acquisition');
    expect(user).toBeTruthy();
  });

  it('falls back to referral or direct and drops bad values', () => {
    expect(sanitizeAcquisition({ referrer: 'https://www.instagram.com/' }, 'email').source).toBe('referral');
    expect(sanitizeAcquisition(null, 'google')).toEqual({ signupMethod: 'google', source: 'direct' });
    const out = sanitizeAcquisition({ source: { $ne: 1 }, firstSeenAt: '2999-01-01', campaign: '<b>x</b>' }, 'email');
    expect(out.source).toBe('direct');
    expect(out.firstSeenAt).toBeUndefined();
    expect(out.campaign).toBe('bx/b');
  });
});

describe('admin growth metrics', () => {
  it('reports signups by source and activation', async () => {
    const { token } = await createUser({ role: 'admin' });
    const vendor = (await createUser({ acquisition: { source: 'instagram' } })).user;
    const organizer = (await createUser({ acquisition: { source: 'vendor_share' } })).user;
    await createUser({ acquisition: { source: 'vendor_share' } });
    const service = await createService(vendor);
    const event = await createEvent(organizer);
    await Booking.create({ service: service._id, organizer: organizer._id, vendor: vendor._id, event: event._id, priceAgreed: 1000, eventDate: event.date || new Date(Date.now() + 7 * 864e5) });

    const res = await request(app).get('/api/v1/admin/growth?days=30').set(auth(token));
    expect(res.status).toBe(200);
    const rows = Object.fromEntries(res.body.data.bySource.map(r => [r.source, r]));
    expect(rows.vendor_share).toMatchObject({ signups: 2, requestedBooking: 1, createdEvent: 1, activated: 1 });
    expect(rows.instagram).toMatchObject({ signups: 1, listedService: 1, activated: 1 });
    expect(res.body.data.funnel.bookingRequests).toBe(1);
    expect(res.body.data.supply.activeVendors).toBe(1);
  });

  it('is admin only', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/v1/admin/growth').set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe('verification email status', () => {
  it('does not claim the email was sent when SMTP is not configured', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'nosmtp@example.com', password: 'Password123', phone: '9876543299', name: 'No Smtp', city: 'Pune'
    });
    expect(res.status).toBe(201);
    expect(res.body.data.emailSent).toBe(false);
    const health = await request(app).get('/api/v1/health');
    expect(health.body.email).toBe('not configured');
  });
});
