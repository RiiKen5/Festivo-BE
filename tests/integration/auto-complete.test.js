const request = require('supertest');
const app = require('../../src/app');
const Booking = require('../../src/models/Booking');
const Event = require('../../src/models/Event');
const { completeOverdueBookings, completePastEvents } = require('../../src/jobs/autoComplete');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

const DAY = 864e5;

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

it('completes confirmed bookings 3 days after the event, and past events', async () => {
  const organizer = await createUser();
  const vendor = await createUser();
  const service = await createService(vendor.user);
  const past = await createEvent(organizer.user, { date: new Date(Date.now() - 5 * DAY), status: 'active' });
  const recent = await createEvent(organizer.user, { date: new Date(Date.now() - 1 * DAY / 2), status: 'active' });

  const mk = (event, status) => Booking.create({
    event: event._id, service: service._id, organizer: organizer.user._id, vendor: vendor.user._id,
    eventDate: event.date, priceAgreed: 1000, status
  });
  const old = await mk(past, 'confirmed');
  const pending = await mk(past, 'pending');
  const fresh = await mk(recent, 'confirmed');

  expect(await completeOverdueBookings()).toBe(1);
  expect((await Booking.findById(old._id)).status).toBe('completed');
  expect((await Booking.findById(pending._id)).status).toBe('pending');
  expect((await Booking.findById(fresh._id)).status).toBe('confirmed');

  expect(await completePastEvents()).toBe(1);
  expect((await Event.findById(past._id)).status).toBe('completed');
  expect((await Event.findById(recent._id)).status).toBe('active');
});

it('organizers cannot complete an event before it happens', async () => {
  const organizer = await createUser();
  const event = await createEvent(organizer.user);
  const res = await request(app).post(`/api/v1/events/${event._id}/complete`).set(auth(organizer.token));
  expect(res.status).toBe(400);
});
