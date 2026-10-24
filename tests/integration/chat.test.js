const request = require('supertest');
const app = require('../../src/app');
const Message = require('../../src/models/Message');
const { connect, clear, disconnect, createUser, createEvent, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const setup = async () => {
  const organizer = await createUser();
  const vendor = await createUser({ userType: 'helper' });
  const event = await createEvent(organizer.user);
  const service = await createService(vendor.user);
  return { organizer, vendor, event, service };
};

describe('booking updates in chat', () => {
  it('posts request, acceptance and cancellation as cards between the two people', async () => {
    const { organizer, vendor, event, service } = await setup();
    const created = await request(app).post('/api/v1/bookings').set(auth(organizer.token))
      .send({ eventId: event._id, serviceId: service._id, priceAgreed: 2000 });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    await request(app).post(`/api/v1/bookings/${id}/confirm`).set(auth(vendor.token)).send({ priceAgreed: 2200 });
    await request(app).post(`/api/v1/bookings/${id}/cancel`).set(auth(organizer.token)).send({ reason: 'Date moved' });

    const cards = await Message.find({ relatedBooking: id, messageType: 'booking' }).sort('createdAt').lean();
    expect(cards.map(c => c.messageText)).toEqual([
      expect.stringMatching(/^Booking request: .*proposed ₹2000$/),
      'Accepted at ₹2200. Pay to lock the date.',
      'Booking cancelled: Date moved'
    ]);
    expect(String(cards[0].sender)).toBe(String(organizer.user._id));
    expect(String(cards[1].sender)).toBe(String(vendor.user._id));

    // They appear in the normal conversation for both people
    const convo = await request(app).get(`/api/v1/messages/conversation/${organizer.user._id}`).set(auth(vendor.token));
    expect(convo.body.data.messages.filter(m => m.messageType === 'booking')).toHaveLength(3);
  });

  it('lists bookings between two people for the chat panel, and nobody else', async () => {
    const { organizer, vendor, event, service } = await setup();
    await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: service._id });
    const stranger = await createUser();

    const mine = await request(app).get(`/api/v1/bookings/with/${vendor.user._id}`).set(auth(organizer.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].service.serviceName).toBeTruthy();

    const theirs = await request(app).get(`/api/v1/bookings/with/${vendor.user._id}`).set(auth(stranger.token));
    expect(theirs.body.data).toHaveLength(0);

    const bad = await request(app).get('/api/v1/bookings/with/not-an-id').set(auth(organizer.token));
    expect(bad.status).toBe(400);
  });

  it('marks messages read when the receiver opens the conversation', async () => {
    const { organizer, vendor } = await setup();
    await request(app).post('/api/v1/messages').set(auth(organizer.token))
      .send({ receiverId: vendor.user._id, messageText: 'Hi, are you free on the 12th?' });
    await request(app).get(`/api/v1/messages/conversation/${organizer.user._id}`).set(auth(vendor.token));
    const msg = await Message.findOne({ sender: organizer.user._id }).lean();
    expect(msg.isRead).toBe(true);
    expect(msg.readAt).toBeTruthy();
  });
});

describe('voice messages', () => {
  it('are sent as a voice message and only the two people can play them', async () => {
    const { organizer, vendor } = await setup();
    const stranger = await createUser();
    const sent = await request(app).post('/api/v1/messages/voice').set(auth(organizer.token))
      .field('receiverId', String(vendor.user._id)).field('durationSec', '7')
      .attach('audio', Buffer.from('fake-webm-audio'), { filename: 'note.webm', contentType: 'audio/webm' });
    expect(sent.status).toBe(201);
    expect(sent.body.data.messageType).toBe('voice');
    const path = sent.body.data.attachments[0];
    expect(path).toMatch(/^\/messages\/voice\/[a-f0-9]{24}\?d=7$/);

    const url = '/api/v1' + path.split('?')[0];
    const heard = await request(app).get(url).set(auth(vendor.token));
    expect(heard.status).toBe(200);
    expect(heard.headers['content-type']).toMatch(/audio\/webm/);
    expect((await request(app).get(url).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('rejects files that are not audio', async () => {
    const { organizer, vendor } = await setup();
    const res = await request(app).post('/api/v1/messages/voice').set(auth(organizer.token))
      .field('receiverId', String(vendor.user._id))
      .attach('audio', Buffer.from('<script>'), { filename: 'x.html', contentType: 'text/html' });
    expect(res.status).toBe(400);
  });
});
