const request = require('supertest');
const app = require('../../src/app');
const Booking = require('../../src/models/Booking');
const Notification = require('../../src/models/Notification');
const Review = require('../../src/models/Review');
const { sendDueReminders } = require('../../src/services/reviewRequestService');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const DAY = 864e5;
const day = (n) => new Date(Date.now() + n * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const request_ = (organizer, service, event, date) => request(app).post('/api/v1/bookings').set(auth(organizer.token))
  .send({ eventId: event._id, serviceId: service._id, eventDate: date, priceAgreed: 3000 });

const accept = (vendor, id, extra = {}) => request(app).post(`/api/v1/bookings/${id}/confirm`).set(auth(vendor.token)).send(extra);

describe('vendor availability', () => {
  let vendor, decor, cakes, orgA, orgB, eventA, eventB;
  beforeEach(async () => {
    vendor = await createUser({ userType: 'helper' });
    decor = await createService(vendor.user, { category: 'decor', serviceName: 'Balloon Arches' });
    cakes = await createService(vendor.user, { category: 'food', serviceName: 'Cakes' });
    orgA = await createUser();
    orgB = await createUser();
    eventA = await createEvent(orgA.user, { title: 'Party A', date: new Date(Date.now() + 20 * DAY) });
    eventB = await createEvent(orgB.user, { title: 'Party B', date: new Date(Date.now() + 20 * DAY) });
  });

  it('decorators take one booking a day by default; a full day cannot be requested', async () => {
    const first = await request_(orgA, decor, eventA, day(20));
    expect(first.status).toBe(201);
    await accept(vendor, first.body.data._id);

    const second = await request_(orgB, decor, eventB, day(20));
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/already booked on/);
    expect(second.body.error.details.reason).toBe('full');

    // Requests (not yet accepted) don't fill the day
    expect((await request_(orgB, decor, eventB, day(21))).status).toBe(201);
  });

  it('cakes have no daily limit unless the vendor sets one', async () => {
    const a = await request_(orgA, cakes, eventA, day(20));
    await accept(vendor, a.body.data._id);
    expect((await request_(orgB, cakes, eventB, day(20))).status).toBe(201);

    await request(app).put(`/api/v1/services/${cakes._id}`).set(auth(vendor.token)).send({ dailyCapacity: 1 });
    const orgC = await createUser();
    const eventC = await createEvent(orgC.user, { title: 'Party C' });
    expect((await request_(orgC, cakes, eventC, day(20))).status).toBe(409);
  });

  it('blocked days cover all of the vendor\'s services and can be unblocked', async () => {
    const blocked = await request(app).put('/api/v1/users/me/calendar').set(auth(vendor.token))
      .send({ block: [day(20), day(-3)] });
    expect(blocked.body.data.blocked).toEqual([day(20)]); // past days are ignored

    for (const service of [decor, cakes]) {
      const res = await request_(orgA, service, eventA, day(20));
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/isn't available on/);
    }

    const range = await request(app).get(`/api/v1/services/${decor._id}/check-availability?from=${day(15)}&to=${day(25)}`);
    expect(range.body.data.blocked).toEqual([day(20)]);

    await request(app).put('/api/v1/users/me/calendar').set(auth(vendor.token)).send({ unblock: [day(20)] });
    expect((await request_(orgA, decor, eventA, day(20))).status).toBe(201);
  });

  it('warns a vendor accepting on a full day, and lets them accept anyway', async () => {
    const a = await request_(orgA, decor, eventA, day(20));
    const b = await request_(orgB, decor, eventB, day(20));
    await accept(vendor, a.body.data._id);

    const warned = await accept(vendor, b.body.data._id);
    expect(warned.status).toBe(409);
    expect(warned.body.error.details).toMatchObject({ reason: 'full', canOverride: true });
    expect(warned.body.error.message).toMatch(/You already have 1 booking on/);

    expect((await accept(vendor, b.body.data._id, { allowOverbook: true })).status).toBe(200);
  });

  it('shows the vendor their month with bookings per day', async () => {
    const a = await request_(orgA, decor, eventA, day(20));
    await request(app).put('/api/v1/users/me/calendar').set(auth(vendor.token)).send({ block: [day(22)] });
    const cal = await request(app).get(`/api/v1/users/me/calendar?from=${day(15)}&to=${day(25)}`).set(auth(vendor.token));
    expect(cal.status).toBe(200);
    expect(cal.body.data.blocked).toEqual([day(22)]);
    expect(cal.body.data.days[day(20)][0]).toMatchObject({ status: 'pending', service: 'Balloon Arches' });
    expect(a.status).toBe(201);
  });

  it('the planner stops suggesting vendors who are busy on the event date', async () => {
    const planner = await createUser();
    const ev = await request(app).post('/api/v1/events').set(auth(planner.token)).send({
      title: 'Riya turns 5', description: 'Birthday at home', eventType: 'birthday',
      date: `${day(20)}T11:30:00.000Z`, time: '17:00', locationName: 'Home', address: 'Baner', city: 'Pune', expectedGuests: 20
    });
    const plan = () => request(app).get(`/api/v1/events/${ev.body.data._id}/plan`).set(auth(planner.token));
    expect((await plan()).body.data.suggestions.decor.map(s => s.serviceName)).toContain('Balloon Arches');
    await request(app).put('/api/v1/users/me/calendar').set(auth(vendor.token)).send({ block: [day(20)] });
    expect((await plan()).body.data.suggestions.decor.map(s => s.serviceName)).not.toContain('Balloon Arches');
  });
});

describe('review requests', () => {
  it('asks the organizer once the booking is completed, reminds once, and stops after a review', async () => {
    const vendor = await createUser({ userType: 'helper' });
    const organizer = await createUser();
    const service = await createService(vendor.user, { category: 'food' });
    const event = await createEvent(organizer.user, { date: new Date(Date.now() - 2 * DAY) });
    const booking = await Booking.create({ service: service._id, organizer: organizer.user._id, vendor: vendor.user._id,
      event: event._id, eventDate: event.date, priceAgreed: 1000, status: 'confirmed' });

    const done = await request(app).post(`/api/v1/bookings/${booking._id}/complete`).set(auth(organizer.token));
    expect(done.status).toBe(200);
    const asks = () => Notification.find({ recipient: organizer.user._id, type: 'review' }).lean();
    expect((await asks()).map(n => n.title)).toEqual([`How was ${vendor.user.name}?`]);
    expect((await asks())[0].actionUrl).toBe(`/bookings/${booking._id}?review=1`);

    // Reminder only after 3 days, and only once
    expect(await sendDueReminders()).toBe(0);
    const later = new Date(Date.now() + 3.5 * DAY);
    expect(await sendDueReminders(later)).toBe(1);
    expect(await sendDueReminders(later)).toBe(0);
    expect((await asks()).map(n => n.title)).toContain(`Still time to review ${vendor.user.name}`);

    // Reviewed bookings get no further asks
    await Booking.updateOne({ _id: booking._id }, { $unset: { reviewReminderSentAt: 1 } });
    await Review.create({ booking: booking._id, service: service._id, vendor: vendor.user._id, reviewer: organizer.user._id, event: event._id, rating: 5, reviewText: 'Lovely cake, on time.' });
    await sendDueReminders(later);
    expect((await asks())).toHaveLength(2);
  });
});
