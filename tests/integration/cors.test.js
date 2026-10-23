const request = require('supertest');
const app = require('../../src/app');
const { frontendUrl } = require('../../src/config/frontend');

describe('CORS with several frontend sites', () => {
  const saved = process.env.FRONTEND_URL;
  beforeAll(() => { process.env.FRONTEND_URL = 'https://festivo.paathly.in, https://festivo-frontend.onrender.com/'; });
  afterAll(() => { process.env.FRONTEND_URL = saved; });

  it.each(['https://festivo.paathly.in', 'https://festivo-frontend.onrender.com'])('allows %s', async (origin) => {
    const res = await request(app).options('/api/v1/auth/login')
      .set('Origin', origin).set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('refuses other sites', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the first site for links', () => {
    expect(frontendUrl()).toBe('https://festivo.paathly.in');
  });
});

describe('rate limit identity', () => {
  const { clientKey } = require('../../src/middlewares/rateLimiter');

  it('uses the address Cloudflare reports, not the shared proxy address', () => {
    expect(clientKey({ headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '10.0.0.1' })).toBe('203.0.113.7');
    expect(clientKey({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
