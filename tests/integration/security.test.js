const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const RSVP = require('../../src/models/RSVP');
const Event = require('../../src/models/Event');
const { connect, clear, disconnect, createUser, createEvent, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

describe('forgot password', () => {
  it('does not return the reset link and does not reveal whether the email exists', async () => {
    const { user } = await createUser();

    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    expect(JSON.stringify(known.body)).not.toMatch(/reset-password\?token=/);

    const stored = await User.findById(user._id);
    expect(stored.passwordResetToken).toBeTruthy();
  });
});

describe('admin registration', () => {
  const payload = {
    email: 'admin@example.com', password: 'Password123!', name: 'Admin', city: 'Pune'
  };

  afterEach(() => { delete process.env.ADMIN_SECRET; });

  it('is disabled when ADMIN_SECRET is not configured', async () => {
    const res = await request(app).post('/api/v1/auth/register-admin')
      .send({ ...payload, adminSecret: 'festivo-admin-secret-2024' });
    expect(res.status).toBe(403);
    expect(await User.countDocuments({ role: 'admin' })).toBe(0);
  });

  it('works with the configured secret only', async () => {
    process.env.ADMIN_SECRET = 'the-real-secret';
    const wrong = await request(app).post('/api/v1/auth/register-admin')
      .send({ ...payload, adminSecret: 'nope' });
    expect(wrong.status).toBe(403);

    const right = await request(app).post('/api/v1/auth/register-admin')
      .send({ ...payload, adminSecret: 'the-real-secret' });
    expect(right.status).toBe(201);
  });
});

describe('private events', () => {
  it('are hidden from strangers but visible to organizers and invitees', async () => {
    const { user: organizer, token: orgToken } = await createUser();
    const { token: strangerToken } = await createUser();
    const event = await createEvent(organizer, { isPublic: false, isPublished: true, status: 'active' });

    const anon = await request(app).get(`/api/v1/events/${event._id}`);
    expect(anon.status).toBe(404);

    const stranger = await request(app).get(`/api/v1/events/${event._id}`).set(auth(strangerToken));
    expect(stranger.status).toBe(404);

    const own = await request(app).get(`/api/v1/events/${event._id}`).set(auth(orgToken));
    expect(own.status).toBe(200);
    expect(own.body.data.inviteCode).toBeTruthy();

    const invited = await request(app)
      .get(`/api/v1/events/${event._id}?invite=${own.body.data.inviteCode}`)
      .set(auth(strangerToken));
    expect(invited.status).toBe(200);
    expect(invited.body.data.inviteCode).toBeUndefined();
  });

  it('are not listed publicly', async () => {
    const { user: organizer } = await createUser();
    await createEvent(organizer, { title: 'Secret', isPublic: false, isPublished: true, status: 'active' });
    await createEvent(organizer, { title: 'Open', isPublic: true, isPublished: true, status: 'active' });

    const res = await request(app).get('/api/v1/events');
    expect(res.body.data.map(e => e.title)).toEqual(['Open']);
  });

  it('require the invite code to RSVP', async () => {
    const { user: organizer } = await createUser();
    const { token } = await createUser();
    const event = await createEvent(organizer, { isPublic: false });
    const { inviteCode } = await Event.findById(event._id).select('+inviteCode');

    const blocked = await request(app).post('/api/v1/rsvps').set(auth(token)).send({ eventId: event._id });
    expect(blocked.status).toBe(404);

    const ok = await request(app).post('/api/v1/rsvps').set(auth(token)).send({ eventId: event._id, inviteCode });
    expect(ok.status).toBe(201);
  });

  it('invite link can be regenerated, invalidating the old one', async () => {
    const { user: organizer, token: orgToken } = await createUser();
    const { token } = await createUser();
    const event = await createEvent(organizer, { isPublic: false });

    const first = await request(app).get(`/api/v1/events/${event._id}/invite`).set(auth(orgToken));
    const second = await request(app).post(`/api/v1/events/${event._id}/invite/regenerate`).set(auth(orgToken));
    expect(second.body.data.inviteCode).not.toBe(first.body.data.inviteCode);

    const old = await request(app).get(`/api/v1/events/${event._id}?invite=${first.body.data.inviteCode}`).set(auth(token));
    expect(old.status).toBe(404);
  });
});

describe('event updates', () => {
  it('ignore protected fields like organizer and counters', async () => {
    const { user: organizer, token } = await createUser();
    const { user: other } = await createUser();
    const event = await createEvent(organizer);

    const res = await request(app).put(`/api/v1/events/${event._id}`).set(auth(token))
      .send({ title: 'Renamed', organizer: other._id, rsvpCount: 999, views: 5000 });

    expect(res.status).toBe(200);
    const stored = await Event.findById(event._id);
    expect(stored.title).toBe('Renamed');
    expect(stored.organizer.toString()).toBe(organizer._id.toString());
    expect(stored.rsvpCount).toBe(0);
    expect(stored.views).toBe(0);
  });
});

describe('RSVPs', () => {
  it('count guests toward capacity and use unguessable check-in codes', async () => {
    const { user: organizer } = await createUser();
    const { token: a } = await createUser();
    const { token: b } = await createUser();
    const event = await createEvent(organizer, { isPublic: true, isPublished: true, status: 'active', maxAttendees: 4 });

    const first = await request(app).post('/api/v1/rsvps').set(auth(a)).send({ eventId: event._id, guestsCount: 2 });
    expect(first.status).toBe(201);
    expect(first.body.data.checkInCode).toMatch(/^[A-Z2-9]{8}$/);

    let stored = await Event.findById(event._id);
    expect(stored.currentAttendees).toBe(3);
    expect(stored.rsvpCount).toBe(1);

    const full = await request(app).post('/api/v1/rsvps').set(auth(b)).send({ eventId: event._id, guestsCount: 1 });
    expect(full.status).toBe(400);

    const fits = await request(app).post('/api/v1/rsvps').set(auth(b)).send({ eventId: event._id });
    expect(fits.status).toBe(201);

    // Updating guests recalculates rather than double counting
    await request(app).put(`/api/v1/rsvps/${first.body.data._id}`).set(auth(a)).send({ guestsCount: 0 });
    stored = await Event.findById(event._id);
    expect(stored.currentAttendees).toBe(2);
    expect(await RSVP.countDocuments()).toBe(2);
  });
});

describe('reviews', () => {
  it('GET /reviews/my-reviews is reachable', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/v1/reviews/my-reviews').set(auth(token));
    expect(res.status).toBe(200);
  });
});
