const request = require('supertest');
const app = require('../../src/app');
const Booking = require('../../src/models/Booking');
const Notification = require('../../src/models/Notification');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const settings = (token, eventId, body) => request(app).put(`/api/v1/offers/events/${eventId}/settings`).set(auth(token)).send(body);
const offer = (token, body) => request(app).post('/api/v1/offers').set(auth(token)).send({ price: 2500, message: 'Two-tier theme cake for 30 guests, delivered.', ...body });

const setup = async () => {
  const organizer = await createUser({ name: 'Rohit' });
  const event = await createEvent(organizer.user, { title: "Aarav's 5th birthday", expectedGuests: 30 });
  const vendor = await createUser({ name: 'Meera', foundingVendor: true });
  const cake = await createService(vendor.user, { serviceName: 'Meera Cakes', category: 'food' });
  return { organizer, event, vendor, cake };
};

describe('vendors offering their services to events', () => {
  it('only events the organizer opened appear, with no private details', async () => {
    const { organizer, event, vendor } = await setup();

    let leads = await request(app).get('/api/v1/offers/leads').set(auth(vendor.token));
    expect(leads.body.data.leads).toHaveLength(0);

    await settings(organizer.token, event._id, { open: true, needs: ['food', 'decor'], note: 'Unicorn theme' }).expect(200);
    leads = await request(app).get('/api/v1/offers/leads').set(auth(vendor.token));
    expect(leads.body.data.leads).toHaveLength(1);
    const lead = leads.body.data.leads[0];
    expect(lead).toMatchObject({ eventType: 'birthday', city: 'Pune', expectedGuests: 30, needs: ['food', 'decor'], note: 'Unicorn theme' });
    // A private event's title, the organizer and the address are never shown
    expect(lead.title).toBeUndefined();
    expect(JSON.stringify(lead)).not.toMatch(/Rohit|1 Main St|Aarav/);

    // Vendors whose services don't match, or in another city, don't see it
    const dj = await createUser();
    await createService(dj.user, { category: 'music' });
    expect((await request(app).get('/api/v1/offers/leads').set(auth(dj.token))).body.data.leads).toHaveLength(0);
    const far = await createUser();
    await createService(far.user, { category: 'food', city: 'Mumbai' });
    expect((await request(app).get('/api/v1/offers/leads').set(auth(far.token))).body.data.leads).toHaveLength(0);
  });

  it('the organizer accepts an offer and it becomes a confirmed booking', async () => {
    const { organizer, event, vendor, cake } = await setup();
    await settings(organizer.token, event._id, { open: true, needs: ['food'] });

    const sent = await offer(vendor.token, { eventId: event._id, serviceId: cake._id });
    expect(sent.status).toBe(201);
    expect(await Notification.countDocuments({ recipient: organizer.user._id, title: 'New Offer' })).toBe(1);
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id }).expect(400);

    const list = await request(app).get(`/api/v1/offers/events/${event._id}`).set(auth(organizer.token));
    expect(list.body.data.offers).toHaveLength(1);
    expect(list.body.data.offers[0]).toMatchObject({ price: 2500, service: { serviceName: 'Meera Cakes' }, vendor: { name: 'Meera' } });
    await request(app).get(`/api/v1/offers/events/${event._id}`).set(auth(vendor.token)).expect(403);

    const accepted = await request(app).post(`/api/v1/offers/${sent.body.data._id}/accept`).set(auth(organizer.token));
    expect(accepted.status).toBe(200);
    const booking = await Booking.findById(accepted.body.data.booking._id).select('+arrivalCode');
    expect(booking).toMatchObject({ status: 'confirmed', priceAgreed: 2500, source: 'marketplace', foundingTerms: true, feePercent: 5 });
    expect(booking.arrivalCode).toMatch(/^\d{4}$/);
    expect(await Notification.countDocuments({ recipient: vendor.user._id, title: 'Offer Accepted' })).toBe(1);

    await request(app).post(`/api/v1/offers/${sent.body.data._id}/accept`).set(auth(organizer.token)).expect(400);
    const leads = await request(app).get('/api/v1/offers/leads').set(auth(vendor.token));
    expect(leads.body.data.leads[0].myOffers[0].status).toBe('accepted');
  });

  it('refuses offers that do not fit, and protects the organizer from floods', async () => {
    const { organizer, event, vendor, cake } = await setup();

    // Not open
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id }).expect(400);
    await settings(organizer.token, event._id, { open: true, needs: ['photography'] });
    // Wrong kind of service
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id }).expect(400);
    await settings(organizer.token, event._id, { open: true, needs: [] });
    // Someone else's service, a vague message, no price
    const other = await createService((await createUser()).user, { category: 'food' });
    await offer(vendor.token, { eventId: event._id, serviceId: other._id }).expect(400);
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id, message: 'hi' }).expect(400);
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id, price: 0 }).expect(400);
    // Only the organizer changes the settings
    await settings(vendor.token, event._id, { open: false }).expect(403);

    // Ten offers a day at most
    for (let i = 0; i < 10; i++) {
      const e = await createEvent(organizer.user, { title: `Party ${i}` });
      await settings(organizer.token, e._id, { open: true });
      await offer(vendor.token, { eventId: e._id, serviceId: cake._id }).expect(201);
    }
    await offer(vendor.token, { eventId: event._id, serviceId: cake._id }).expect(429);
  });

  it('declined and withdrawn offers', async () => {
    const { organizer, event, vendor, cake } = await setup();
    await settings(organizer.token, event._id, { open: true });
    const first = await offer(vendor.token, { eventId: event._id, serviceId: cake._id });
    await request(app).post(`/api/v1/offers/${first.body.data._id}/withdraw`).set(auth(vendor.token)).expect(200);
    expect((await request(app).get(`/api/v1/offers/events/${event._id}`).set(auth(organizer.token))).body.data.offers).toHaveLength(0);

    // After withdrawing, the vendor can offer again; the organizer declines
    const second = await offer(vendor.token, { eventId: event._id, serviceId: cake._id, price: 2200 });
    expect(second.status).toBe(201);
    await request(app).post(`/api/v1/offers/${second.body.data._id}/decline`).set(auth(vendor.token)).expect(403);
    await request(app).post(`/api/v1/offers/${second.body.data._id}/decline`).set(auth(organizer.token)).expect(200);
    const mine = await request(app).get('/api/v1/offers/mine').set(auth(vendor.token));
    expect(mine.body.data.map(o => o.status).sort()).toEqual(['declined', 'withdrawn']);
    expect(await Booking.countDocuments()).toBe(0);
  });
});
