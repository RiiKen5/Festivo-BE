const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Service = require('../../src/models/Service');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const intake = (overrides = {}) => ({
  name: 'Meera Kulkarni',
  email: 'Meera.Bakes@example.com',
  phone: '98765 43210',
  city: 'Bangalore',
  service: {
    serviceName: "Meera's Theme Cakes",
    category: 'food',
    description: 'Eggless theme cakes for birthdays, made to order.',
    basePrice: 1200,
    priceUnit: 'per_event',
    serviceAreas: ['HSR Layout', 'Koramangala'],
    isVerified: true
  },
  ...overrides
});

const tokenFrom = (url) => new URL(url).searchParams.get('token');

describe('admin lists a vendor from their intake form', () => {
  it('creates the account and listing, and the vendor claims it with the link', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).post('/api/v1/admin/vendors').set(auth(admin.token)).send(intake());
    expect(res.status).toBe(201);
    expect(res.body.data.claimUrl).toMatch(/\/auth\/reset-password\?token=[0-9a-f]{64}&welcome=1$/);

    const vendor = await User.findById(res.body.data.vendor._id);
    expect(vendor).toMatchObject({ email: 'meera.bakes@example.com', phone: '+919876543210', city: 'Bengaluru', userType: 'helper', foundingVendor: true });
    expect(vendor.onboardedBy.toString()).toBe(admin.user._id.toString());
    expect(vendor.claimedAt).toBeUndefined();

    const service = await Service.findById(res.body.data.service._id);
    expect(service).toMatchObject({ city: 'Bengaluru', basePrice: 1200, isVerified: false });
    expect(service.provider.toString()).toBe(vendor._id.toString());

    // The vendor sets a password with the link and can log in
    await request(app).post('/api/v1/auth/reset-password')
      .send({ token: tokenFrom(res.body.data.claimUrl), newPassword: 'MeeraCakes123!' }).expect(200);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'meera.bakes@example.com', password: 'MeeraCakes123!' });
    expect(login.status).toBe(200);
    expect((await User.findById(vendor._id)).claimedAt).toBeTruthy();

    // Once claimed, no new links
    await request(app).post(`/api/v1/admin/vendors/${vendor._id}/claim-link`).set(auth(admin.token)).expect(400);
  });

  it('a new link replaces the old one', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).post('/api/v1/admin/vendors').set(auth(admin.token)).send(intake());
    const again = await request(app).post(`/api/v1/admin/vendors/${res.body.data.vendor._id}/claim-link`).set(auth(admin.token));
    expect(again.status).toBe(200);

    await request(app).post('/api/v1/auth/reset-password')
      .send({ token: tokenFrom(res.body.data.claimUrl), newPassword: 'MeeraCakes123!' }).expect(400);
    await request(app).post('/api/v1/auth/reset-password')
      .send({ token: tokenFrom(again.body.data.claimUrl), newPassword: 'MeeraCakes123!' }).expect(200);
  });

  it('refuses a duplicate email or phone and leaves nothing behind on a bad listing', async () => {
    const admin = await createUser({ role: 'admin' });
    await createUser({ email: 'taken@example.com', phone: '+919999988888' });

    const email = await request(app).post('/api/v1/admin/vendors').set(auth(admin.token)).send(intake({ email: 'taken@example.com' }));
    expect(email.status).toBe(409);
    const phone = await request(app).post('/api/v1/admin/vendors').set(auth(admin.token)).send(intake({ phone: '99999 88888' }));
    expect(phone.status).toBe(409);

    const bad = await request(app).post('/api/v1/admin/vendors').set(auth(admin.token))
      .send(intake({ service: { ...intake().service, priceUnit: 'per_kg' } }));
    expect(bad.status).toBe(400);
    expect(await User.countDocuments({ email: 'meera.bakes@example.com' })).toBe(0);
  });

  it('is admin only', async () => {
    const user = await createUser();
    await request(app).post('/api/v1/admin/vendors').set(auth(user.token)).send(intake()).expect(403);
  });
});

describe('admin chases unanswered booking requests', () => {
  it('lists pending requests with the vendor phone and records a WhatsApp nudge', async () => {
    const admin = await createUser({ role: 'admin' });
    const vendor = await createUser({ name: 'Arjun', phone: '+919812345678' });
    const service = await createService(vendor.user);
    const organizer = await createUser({ name: 'Rohit' });
    const event = await createEvent(organizer.user);
    const booking = await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id });

    const list = await request(app).get('/api/v1/admin/requests').set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ vendor: { name: 'Arjun', phone: '+919812345678' }, organizer: { name: 'Rohit' } });
    expect(list.body.data[0].vendorNudgedAt).toBeUndefined();

    const nudged = await request(app).post(`/api/v1/admin/requests/${booking.body.data._id}/nudged`).set(auth(admin.token));
    expect(nudged.status).toBe(200);
    const after = await request(app).get('/api/v1/admin/requests').set(auth(admin.token));
    expect(after.body.data[0].vendorNudgedAt).toBeTruthy();
  });
});
