const request = require('supertest');
const app = require('../../src/app');
const Task = require('../../src/models/Task');
const { connect, clear, disconnect, createUser, createService, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const newEvent = (token, extra = {}) => request(app).post('/api/v1/events').set(auth(token)).send({
  title: 'Riya turns 5', description: 'Birthday party at home', eventType: 'birthday',
  date: new Date(Date.now() + 30 * 864e5).toISOString(), time: '17:00',
  locationName: 'Home', address: 'Baner', city: 'Pune', expectedGuests: 25, ...extra
});

describe('event planner', () => {
  it('creates a checklist for the event type, due before the event', async () => {
    const { token } = await createUser();
    const res = await newEvent(token);
    expect(res.status).toBe(201);
    const tasks = await Task.find({ event: res.body.data._id }).lean();
    expect(tasks.map(t => t.taskName)).toEqual(expect.arrayContaining(['Order the birthday cake', 'Book decorations']));
    const eventDate = new Date(res.body.data.date).getTime();
    expect(tasks.every(t => new Date(t.dueDate).getTime() <= eventDate)).toBe(true);
  });

  it('can be skipped', async () => {
    const { token } = await createUser();
    const res = await newEvent(token, { withChecklist: false });
    expect(await Task.countDocuments({ event: res.body.data._id })).toBe(0);
  });

  it('suggests vendors in the event city for open items, and stops once one is booked', async () => {
    const organizer = await createUser();
    const baker = await createUser({ userType: 'helper' });
    const cake = await createService(baker.user, { category: 'food', city: 'Pune', serviceName: 'Pune Cakes' });
    await createService(baker.user, { category: 'food', city: 'Mumbai', serviceName: 'Mumbai Cakes' });
    const event = (await newEvent(organizer.token)).body.data;

    let plan = await request(app).get(`/api/v1/events/${event._id}/plan`).set(auth(organizer.token));
    expect(plan.status).toBe(200);
    expect(plan.body.data.suggestions.food.map(s => s.serviceName)).toEqual(['Pune Cakes']);

    await request(app).post('/api/v1/bookings').set(auth(organizer.token)).send({ eventId: event._id, serviceId: cake._id });
    plan = await request(app).get(`/api/v1/events/${event._id}/plan`).set(auth(organizer.token));
    expect(plan.body.data.suggestions.food).toBeUndefined();
    expect(plan.body.data.bookings[0].service.category).toBe('food');
  });

  it('is only for organizers', async () => {
    const organizer = await createUser();
    const other = await createUser();
    const event = (await newEvent(organizer.token)).body.data;
    const res = await request(app).get(`/api/v1/events/${event._id}/plan`).set(auth(other.token));
    expect(res.status).toBe(403);
  });
});
