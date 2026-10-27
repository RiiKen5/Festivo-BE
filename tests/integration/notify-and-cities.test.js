const request = require('supertest');
const app = require('../../src/app');
const emailService = require('../../src/services/emailService');
const Service = require('../../src/models/Service');
const User = require('../../src/models/User');
const RSVP = require('../../src/models/RSVP');
const { normalizeStoredCities } = require('../../src/config/database');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

let sent;
beforeAll(async () => { await connect(); await RSVP.createIndexes(); });
afterAll(disconnect);
beforeEach(() => {
  sent = [];
  jest.spyOn(emailService, 'sendEmail').mockImplementation(async (mail) => { sent.push(mail); return { messageId: 'x' }; });
});
afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.FOUNDING_VENDOR_LIMIT;
  await clear();
});

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
  return false;
};

describe('city names', () => {
  it('finds Bengaluru listings however the city was spelled, and stores the standard name', async () => {
    const vendor = await createUser({ city: 'bangalore' });
    expect(vendor.user.city).toBe('Bengaluru');
    await createService(vendor.user, { serviceName: 'Cakes by Meera', city: 'Banglore' });
    expect((await Service.findOne({ serviceName: 'Cakes by Meera' })).city).toBe('Bengaluru');

    // Saved before names were standardised
    await Service.collection.insertOne({ serviceName: 'Old Listing', provider: vendor.user._id, category: 'decor', description: 'x', basePrice: 1, city: 'BANGLORE', isActive: true, noShowCount: 0 });

    for (const q of ['Bengaluru', 'Bangalore', 'banglore']) {
      const res = await request(app).get(`/api/v1/services?city=${q}`);
      expect(res.body.data.map(s => s.serviceName).sort()).toEqual(['Cakes by Meera', 'Old Listing']);
    }
    expect((await request(app).get('/api/v1/services?city=Pune')).body.data).toHaveLength(0);

    await normalizeStoredCities();
    expect((await Service.findOne({ serviceName: 'Old Listing' })).city).toBe('Bengaluru');
  });
});

describe('emails for important notifications', () => {
  it('emails the vendor a new booking request, without holding up the request', async () => {
    const organizer = await createUser({ name: 'Rohit' });
    const vendor = await createUser({ email: 'meera@example.com', name: 'Meera' });
    const service = await createService(vendor.user, { serviceName: 'Cakes by Meera' });
    const event = await createEvent(organizer.user);

    await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id }).expect(201);
    expect(await until(() => sent.length === 1)).toBe(true);
    expect(sent[0].to).toBe('meera@example.com');
    expect(sent[0].subject).toBe('New Booking Request - Festivo');
    expect(sent[0].html).toMatch(/Rohit wants to book Cakes by Meera/);
    expect(sent[0].html).toMatch(/\/bookings\//);
  });

  it('a failing mail server does not break anything', async () => {
    emailService.sendEmail.mockRejectedValue(new Error('SMTP down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const organizer = await createUser();
    const vendor = await createUser();
    const service = await createService(vendor.user);
    const event = await createEvent(organizer.user);
    await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id }).expect(201);
  });
});

describe('admin founding switch', () => {
  it('lists vendors and grants founding terms up to the limit', async () => {
    process.env.FOUNDING_VENDOR_LIMIT = '1';
    const admin = await createUser({ role: 'admin' });
    const a = await createUser({ name: 'Early Vendor' });
    const b = await createUser({ name: 'Second Vendor' });
    await createService(a.user);
    await createService(b.user);

    await request(app).get('/api/v1/admin/vendors').set(auth(a.token)).expect(403);
    const list = await request(app).get('/api/v1/admin/vendors').set(auth(admin.token));
    expect(list.body.data.vendors.map(v => v.name)).toEqual(['Early Vendor', 'Second Vendor']);
    expect(list.body.data.founding).toMatchObject({ taken: 0, limit: 1, open: true });

    await request(app).post(`/api/v1/admin/vendors/${a.user._id}/founding`).set(auth(admin.token)).send({ founding: true }).expect(200);
    const full = await request(app).post(`/api/v1/admin/vendors/${b.user._id}/founding`).set(auth(admin.token)).send({ founding: true });
    expect(full.body.error.message).toMatch(/All 1 founding spots are taken/);

    await request(app).post(`/api/v1/admin/vendors/${a.user._id}/founding`).set(auth(admin.token)).send({ founding: false }).expect(200);
    expect((await User.findById(a.user._id)).foundingVendor).toBe(false);
  });
});

describe('guest check-in code by email', () => {
  it('emails the code and a private link that restores the RSVP; the host never sees the email', async () => {
    const host = await createUser();
    const event = await createEvent(host.user, { isPublic: true, isPublished: true });
    const res = await request(app).post('/api/v1/rsvps/guest')
      .send({ eventId: event._id, name: 'Asha', email: 'Asha@Example.com' });
    expect(res.status).toBe(201);
    const { guestToken, rsvp } = res.body.data;

    expect(await until(() => sent.some(m => m.to === 'asha@example.com'))).toBe(true);
    const mail = sent.find(m => m.to === 'asha@example.com');
    expect(mail.html).toContain(rsvp.checkInCode);
    expect(mail.html).toContain(`/events/${event.slug}?guest=${encodeURIComponent(guestToken)}`);

    expect((await request(app).post('/api/v1/rsvps/guest').send({ eventId: event._id, name: 'Ravi', email: 'not-an-email' })).status).toBe(400);

    const list = await request(app).get(`/api/v1/rsvps/event/${event._id}`).set(auth(host.token));
    expect(list.body.data[0].guestEmail).toBeUndefined();
  });
});
