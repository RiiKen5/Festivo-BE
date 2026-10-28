const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Booking = require('../../src/models/Booking');
const Service = require('../../src/models/Service');
const RSVP = require('../../src/models/RSVP');
const Notification = require('../../src/models/Notification');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => { await connect(); await RSVP.createIndexes(); });
afterEach(clear);
afterAll(disconnect);

const del = (token, confirm = 'DELETE') => request(app).delete('/api/v1/users/me').set(auth(token)).send({ confirm });

describe('deleting your own account', () => {
  it('erases personal details, takes listings down, cancels open requests and signs out', async () => {
    const vendor = await createUser({ name: 'Meera Bakes', phone: '9876543210', bio: 'Cakes' });
    const service = await createService(vendor.user);
    const organizer = await createUser();
    const event = await createEvent(organizer.user);
    const req = await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id });
    await Notification.createNotification({ recipient: vendor.user._id, type: 'system', title: 'Hi', message: 'Hello' });

    await del(vendor.token, 'yes').expect(400);
    const check = await request(app).get('/api/v1/users/me/deletion-check').set(auth(vendor.token));
    expect(check.body.data).toEqual({ canDelete: true, blockers: [] });

    const res = await del(vendor.token);
    expect(res.status).toBe(200);

    const gone = await User.findById(vendor.user._id).select('+refreshTokens');
    expect(gone).toMatchObject({ name: 'Deleted user', isActive: false });
    expect(gone.email).toMatch(/@deleted\.festivo\.invalid$/);
    expect(gone.phone).toBeUndefined();
    expect(gone.bio).toBeUndefined();
    expect(gone.deletedAt).toBeTruthy();
    expect((await Service.findById(service._id)).isActive).toBe(false);
    expect((await Booking.findById(req.body.data._id)).status).toBe('cancelled');
    expect(await Notification.countDocuments({ recipient: vendor.user._id })).toBe(0);

    // Signed out everywhere, and the old email can't log in
    const after = await request(app).get('/api/v1/users/me').set(auth(vendor.token));
    expect([401, 403]).toContain(after.status);
    const login = await request(app).post('/api/v1/auth/login').send({ email: vendor.user.email, password: 'Password123!' });
    expect(login.status).toBe(401);
  });

  it('is blocked while money or other people still depend on the account', async () => {
    const host = await createUser();
    await createEvent(host.user, { date: new Date(Date.now() + 10 * DAY), status: 'active' });
    const vendor = await createUser({ penaltyDue: 500 });

    const res = await del(host.token);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/upcoming event/);
    expect((await User.findById(host.user._id)).isActive).toBe(true);

    const check = await request(app).get('/api/v1/users/me/deletion-check').set(auth(vendor.token));
    expect(check.body.data.canDelete).toBe(false);
    expect(check.body.data.blockers[0]).toMatch(/You owe Festivo ₹500/);
  });

  it('a past event keeps its history; free RSVPs are cancelled', async () => {
    const guest = await createUser();
    const host = await createUser();
    const party = await createEvent(host.user, { isPublic: true, isPublished: true });
    await request(app).post('/api/v1/rsvps').set(auth(guest.token)).send({ eventId: party._id }).expect(201);
    await createEvent(guest.user, { date: new Date(Date.now() - 30 * DAY), status: 'completed' });

    await del(guest.token).expect(200);
    expect((await RSVP.findOne({ attendee: guest.user._id })).status).toBe('cancelled');
  });
});
