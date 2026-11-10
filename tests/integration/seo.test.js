const request = require('supertest');
const axios = require('axios');
const app = require('../../src/app');
const Service = require('../../src/models/Service');
const Event = require('../../src/models/Event');
const seoService = require('../../src/services/seoService');
const { connect, clear, disconnect, createUser, createEvent, createService } = require('../helpers');

jest.mock('axios');

beforeAll(connect);
afterEach(async () => {
  await clear();
  jest.clearAllMocks();
  delete process.env.FRONTEND_DEPLOY_HOOK_URL;
  delete process.env.INDEXNOW_KEY;
});
afterAll(disconnect);

const DAY = 24 * 60 * 60 * 1000;

describe('pages search engines may index', () => {
  it('lists active services and upcoming public events, never private ones', async () => {
    const { user } = await createUser({ name: 'Meera' });
    await createService(user, { serviceName: 'Meera Cakes', totalRatings: 0 });
    await createService(user, { serviceName: 'Old Listing', isActive: false });
    await createEvent(user, { title: 'Holi in the Park', isPublic: true, isPublished: true, status: 'active' });
    await createEvent(user, { title: "Aarav's 5th birthday", isPublic: false, isPublished: true, status: 'active' });
    await createEvent(user, { title: 'Unpublished Draft', isPublic: true, isPublished: false });
    await createEvent(user, { title: 'Cancelled Gig', isPublic: true, isPublished: true, status: 'cancelled' });
    await createEvent(user, { title: 'Last Year', isPublic: true, isPublished: true, status: 'completed', date: new Date(Date.now() - 30 * DAY) });

    const res = await request(app).get('/api/v1/seo/pages').expect(200);
    const { services, events } = res.body.data;
    expect(services.map(s => s.name)).toEqual(['Meera Cakes']);
    expect(services[0]).toMatchObject({ category: 'food', city: 'Pune', price: 2000, provider: 'Meera', rating: null });
    expect(events.map(e => e.title)).toEqual(['Holi in the Park']);
    expect(JSON.stringify(res.body)).not.toMatch(/inviteCode|email|phone/);
  });

  it('viewing a listing does not change its last-modified date', async () => {
    const { user } = await createUser();
    const service = await createService(user);
    const before = (await Service.findById(service._id)).updatedAt;
    await new Promise(r => setTimeout(r, 20));
    await request(app).get(`/api/v1/services/slug/${service.slug}`).expect(200);
    const after = await Service.findById(service._id);
    expect(after.views).toBe(1);
    expect(after.updatedAt).toEqual(before);
  });
});

describe('rebuilding pages and telling search engines', () => {
  it('does nothing without a deploy hook', async () => {
    expect(await seoService.refreshSearchPages()).toEqual({ rebuilt: false, notified: 0 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rebuilds after listings change, then pings IndexNow once the build is live', async () => {
    process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://api.render.com/deploy/srv-x?key=y';
    process.env.INDEXNOW_KEY = 'abc123abc123';
    axios.post.mockResolvedValue({ status: 200 });
    const t0 = new Date();

    // First run only starts the clock
    await seoService.refreshSearchPages(t0);
    expect(axios.post).not.toHaveBeenCalled();

    const { user } = await createUser();
    const service = await createService(user, { serviceName: 'Balloon Arches' });
    await createEvent(user, { title: 'Private party', isPublic: false });

    // Too soon after the last build
    const soon = new Date(t0.getTime() + 60 * 60 * 1000);
    expect((await seoService.refreshSearchPages(soon)).rebuilt).toBe(false);

    const later = new Date(t0.getTime() + seoService.MIN_REBUILD_GAP);
    expect(await seoService.refreshSearchPages(later)).toEqual({ rebuilt: true, notified: 0 });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe(process.env.FRONTEND_DEPLOY_HOOK_URL);

    // The build has had time to go live: IndexNow gets the changed URL only
    const live = new Date(later.getTime() + seoService.BUILD_TIME);
    expect(await seoService.refreshSearchPages(live)).toEqual({ rebuilt: false, notified: 1 });
    const [url, body] = axios.post.mock.calls[1];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(body).toEqual({
      host: 'yaay.paathly.in',
      key: 'abc123abc123',
      keyLocation: 'https://yaay.paathly.in/abc123abc123.txt',
      urlList: [`https://yaay.paathly.in/services/${service.slug}`]
    });

    // Nothing new: no more builds or pings
    const quiet = new Date(live.getTime() + seoService.MIN_REBUILD_GAP);
    expect(await seoService.refreshSearchPages(quiet)).toEqual({ rebuilt: false, notified: 0 });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when a listing is deleted, and tells search engines it is gone', async () => {
    process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://api.render.com/deploy/srv-x?key=y';
    process.env.INDEXNOW_KEY = 'abc123abc123';
    axios.post.mockResolvedValue({ status: 200 });
    const { user } = await createUser();
    const service = await createService(user, { serviceName: 'Demo Cakes' });
    const t0 = new Date(Date.now() + 60 * 1000);
    await seoService.refreshSearchPages(t0);

    await Service.deleteOne({ _id: service._id });
    const later = new Date(t0.getTime() + seoService.MIN_REBUILD_GAP);
    expect(await seoService.refreshSearchPages(later)).toEqual({ rebuilt: true, notified: 0 });

    const live = new Date(later.getTime() + seoService.BUILD_TIME);
    expect(await seoService.refreshSearchPages(live)).toEqual({ rebuilt: false, notified: 1 });
    expect(axios.post.mock.calls[1][1].urlList).toEqual([`https://yaay.paathly.in/services/${service.slug}`]);
  });

  it('keeps the URLs for next time if IndexNow fails', async () => {
    process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://api.render.com/deploy/srv-x?key=y';
    process.env.INDEXNOW_KEY = 'abc123abc123';
    const t0 = new Date();
    await seoService.refreshSearchPages(t0);
    const { user } = await createUser();
    await createEvent(user, { title: 'Garba Night', isPublic: true, isPublished: true, status: 'active' });

    axios.post.mockResolvedValueOnce({ status: 200 }); // deploy hook
    const later = new Date(t0.getTime() + seoService.MIN_REBUILD_GAP);
    await seoService.refreshSearchPages(later);

    axios.post.mockRejectedValueOnce(new Error('503'));
    const live = new Date(later.getTime() + seoService.BUILD_TIME);
    expect((await seoService.refreshSearchPages(live)).notified).toBe(0);

    axios.post.mockResolvedValueOnce({ status: 200 });
    const retry = new Date(live.getTime() + 60 * 60 * 1000);
    expect((await seoService.refreshSearchPages(retry)).notified).toBe(1);
    expect(await Event.countDocuments()).toBe(1);
  });
});
