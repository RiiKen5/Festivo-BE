const request = require('supertest');
const app = require('../../src/app');
const RSVP = require('../../src/models/RSVP');
const Event = require('../../src/models/Event');
const Notification = require('../../src/models/Notification');
const { connect, clear, disconnect, createUser, createEvent, auth } = require('../helpers');

beforeAll(async () => { await connect(); await RSVP.createIndexes(); });
afterEach(clear);
afterAll(disconnect);

const rsvp = (body) => request(app).post('/api/v1/rsvps/guest').send(body);

describe('RSVP without an account', () => {
  it('lets several guests RSVP to an invite-only event with just a name, and counts heads', async () => {
    const host = await createUser();
    const event = await createEvent(host.user, { isPublic: false, maxAttendees: 10 });
    const { inviteCode } = await Event.findById(event._id).select('+inviteCode').lean();

    const a = await rsvp({ eventId: event._id, inviteCode, name: 'Asha Rao', guestsCount: 2 });
    expect(a.status).toBe(201);
    expect(a.body.data.rsvp.checkInCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(a.body.data.guestToken.length).toBeGreaterThan(20);
    const b = await rsvp({ eventId: event._id, inviteCode, name: 'Ravi', phone: '+91 98765 43210', status: 'maybe' });
    expect(b.status).toBe(201);

    expect((await Event.findById(event._id)).currentAttendees).toBe(3);
    expect(await Notification.countDocuments({ recipient: host.user._id, type: 'rsvp' })).toBe(1);

    // The host sees names and the phone number; nobody else can list them
    const list = await request(app).get(`/api/v1/rsvps/event/${event._id}`).set(auth(host.token));
    expect(list.body.data.map(r => r.guestName).sort()).toEqual(['Asha Rao', 'Ravi']);
    expect(list.body.data.find(r => r.guestName === 'Ravi').guestPhone).toBe('9876543210');
    const stranger = await createUser();
    expect((await request(app).get(`/api/v1/rsvps/event/${event._id}`).set(auth(stranger.token))).status).toBe(403);
  });

  it('needs the invite link for private events', async () => {
    const host = await createUser();
    const event = await createEvent(host.user, { isPublic: false });
    expect((await rsvp({ eventId: event._id, name: 'Asha' })).status).toBe(404);
    expect((await rsvp({ eventId: event._id, inviteCode: 'wrong', name: 'Asha' })).status).toBe(404);
  });

  it('lets the guest change their answer with their token, or by the same phone', async () => {
    const host = await createUser();
    const event = await createEvent(host.user, { isPublic: true, isPublished: true });
    const first = await rsvp({ eventId: event._id, name: 'Asha', phone: '9876543210', guestsCount: 1 });
    const token = first.body.data.guestToken;

    const changed = await rsvp({ eventId: event._id, guestToken: token, name: 'Asha', status: 'not_going' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.guestToken).toBe(token);
    expect(changed.body.data.rsvp.checkInCode).toBeUndefined();

    const byPhone = await rsvp({ eventId: event._id, name: 'Asha R', phone: '09876543210', status: 'going' });
    expect(byPhone.status).toBe(200);
    expect(await RSVP.countDocuments({ event: event._id })).toBe(1);

    const mine = await request(app).get(`/api/v1/rsvps/guest?token=${byPhone.body.data.guestToken}`);
    expect(mine.body.data).toMatchObject({ guestName: 'Asha R', status: 'going' });
    expect(mine.body.data.guestPhone).toBeUndefined();
    // The old token no longer works after the phone match issued a new one
    expect((await request(app).get(`/api/v1/rsvps/guest?token=${token}`)).status).toBe(404);
  });

  it('needs a phone number to buy a ticket, respects capacity and rejects bad input', async () => {
    const host = await createUser();
    const paid = await createEvent(host.user, { isPublic: true, isPublished: true, entryFee: 499, isPaid: true });
    const p = await rsvp({ eventId: paid._id, name: 'Asha' });
    expect(p.status).toBe(400);
    expect(p.body.error.message).toMatch(/mobile number to buy a ticket/);

    const small = await createEvent(host.user, { isPublic: true, isPublished: true, maxAttendees: 2 });
    expect((await rsvp({ eventId: small._id, name: 'Big family', guestsCount: 2 })).status).toBe(400);
    expect((await rsvp({ eventId: small._id, name: 'A' })).status).toBe(400);
    expect((await rsvp({ eventId: small._id, name: 'Asha', phone: '12345' })).status).toBe(400);
    expect((await rsvp({ eventId: small._id, name: 'Asha', guestsCount: 11 })).status).toBe(400);
  });

  it('check-in by code works for guests, and cancelling the event does not fail on them', async () => {
    const host = await createUser();
    const event = await createEvent(host.user, { isPublic: true, isPublished: true, date: new Date(Date.now() + 864e5) });
    const g = await rsvp({ eventId: event._id, name: 'Asha' });
    const code = g.body.data.rsvp.checkInCode;
    const checked = await request(app).post('/api/v1/rsvps/check-in-code').set(auth(host.token)).send({ eventId: event._id, code });
    expect(checked.status).toBe(200);

    await rsvp({ eventId: event._id, name: 'Ravi' });
    const cancelled = await request(app).post(`/api/v1/events/${event._id}/cancel`).set(auth(host.token)).send({ reason: 'Rain' });
    expect(cancelled.status).toBe(200);
    expect(await RSVP.countDocuments({ event: event._id, status: 'cancelled' })).toBe(2);
  });

  it('signed-in RSVPs still allow only one per user', async () => {
    const host = await createUser();
    const guest = await createUser();
    const event = await createEvent(host.user, { isPublic: true, isPublished: true });
    await RSVP.create({ event: event._id, attendee: guest.user._id });
    await expect(RSVP.create({ event: event._id, attendee: guest.user._id })).rejects.toThrow(/duplicate/);
  });
});
