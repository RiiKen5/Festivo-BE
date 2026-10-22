// Requests here mirror exactly what the Angular app sends (see
// frontend/src/app/core/services). If one of these breaks, the web app breaks.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const RSVP = require('../../src/models/RSVP');
const Review = require('../../src/models/Review');
const { hashToken } = require('../../src/utils/helpers');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

it('organizer books a vendor (service-detail booking form)', async () => {
  const organizer = await createUser();
  const vendor = await createUser();
  const event = await createEvent(organizer.user);
  const service = await createService(vendor.user);

  const res = await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({
    eventId: event._id.toString(),
    serviceId: service._id.toString(),
    eventDate: event.date.toISOString().split('T')[0],
    priceAgreed: 1800
  });
  expect(res.status).toBe(201);
  expect(res.body.data.priceAgreed).toBe(1800);
});

it('organizer adds a checklist task with any category offered in the UI', async () => {
  const organizer = await createUser();
  const event = await createEvent(organizer.user);

  for (const category of ['venue', 'catering', 'decoration', 'entertainment', 'photography', 'guest_management', 'logistics', 'budget', 'other']) {
    const res = await request(app).post('/api/v1/tasks').set(auth(organizer.token)).send({
      eventId: event._id.toString(),
      taskName: `Task ${category}`,
      category,
      priority: 'medium'
    });
    expect(res.status).toBe(201);
  }
});

it('users message each other and mark the conversation read', async () => {
  const a = await createUser();
  const b = await createUser();

  const sent = await request(app).post('/api/v1/messages').set(auth(a.token))
    .send({ receiverId: b.user._id.toString(), messageText: 'Hi! Are you free on the 12th?' });
  expect(sent.status).toBe(201);

  const conversations = await request(app).get('/api/v1/messages/conversations').set(auth(b.token));
  expect(conversations.body.data[0].otherUser.name).toBe(a.user.name);
  expect(conversations.body.data[0].unreadCount).toBe(1);

  const thread = await request(app).get(`/api/v1/messages/conversation/${a.user._id}`).set(auth(b.token));
  expect(thread.body.data.messages).toHaveLength(1);

  await request(app).put(`/api/v1/messages/read/${a.user._id}`).set(auth(b.token)).expect(200);
  const unread = await request(app).get('/api/v1/messages/unread-count').set(auth(b.token));
  expect(unread.body.data.unreadCount).toBe(0);
});

it('organizer reviews a completed booking and the vendor responds', async () => {
  const organizer = await createUser();
  const vendor = await createUser();
  const event = await createEvent(organizer.user);
  const service = await createService(vendor.user);
  const booking = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
    .send({ eventId: event._id, serviceId: service._id });
  const id = booking.body.data._id;
  await request(app).post(`/api/v1/bookings/${id}/confirm`).set(auth(vendor.token)).send({ priceAgreed: 2000 });
  await request(app).post(`/api/v1/bookings/${id}/complete`).set(auth(organizer.token)).expect(200);

  const review = await request(app).post('/api/v1/reviews').set(auth(organizer.token)).send({
    bookingId: id,
    rating: 5,
    reviewText: 'Amazing cake, everyone loved it!',
    ratings: { quality: 5, punctuality: 5, professionalism: 5, valueForMoney: 4 }
  });
  expect(review.status).toBe(201);

  const reply = await request(app).post(`/api/v1/reviews/${review.body.data._id}/respond`)
    .set(auth(vendor.token)).send({ response: 'Thank you so much!' });
  expect(reply.status).toBe(200);
  expect((await Review.findById(review.body.data._id)).vendorResponse).toBe('Thank you so much!');
});

it('user resets their password from the emailed link', async () => {
  const { user } = await createUser();
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, {
    passwordResetToken: hashToken(token),
    passwordResetExpires: Date.now() + 10 * 60 * 1000
  });

  const res = await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'NewPassword456!' });
  expect(res.status).toBe(200);

  const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'NewPassword456!' });
  expect(login.status).toBe(200);
});

it('organizer checks in an attendee', async () => {
  const organizer = await createUser();
  const attendee = await createUser();
  const event = await createEvent(organizer.user, { isPublic: true, isPublished: true, status: 'active' });
  const rsvp = await request(app).post('/api/v1/rsvps').set(auth(attendee.token))
    .send({ eventId: event._id, status: 'going', guestsCount: 0 });

  const res = await request(app).post(`/api/v1/rsvps/${rsvp.body.data._id}/check-in`).set(auth(organizer.token)).send({});
  expect(res.status).toBe(200);
  expect((await RSVP.findById(rsvp.body.data._id)).checkedIn).toBe(true);
});

it('event pages load by id as well as slug (links from bookings and notifications)', async () => {
  const organizer = await createUser();
  const event = await createEvent(organizer.user, { isPublic: true, isPublished: true, status: 'active' });

  await request(app).get(`/api/v1/events/${event._id}`).expect(200);
  await request(app).get(`/api/v1/events/slug/${event.slug}`).expect(200);
});

it('errors carry a readable message for the UI', async () => {
  const res = await request(app).post('/api/v1/bookings').set(auth((await createUser()).token)).send({});
  expect(res.status).toBe(400);
  expect(res.body.error.details[0].message).toBe('Invalid event ID');
});
