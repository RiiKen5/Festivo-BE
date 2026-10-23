const request = require('supertest');
const sharp = require('sharp');
const app = require('../../src/app');
const User = require('../../src/models/User');
const { connect, clear, disconnect, createUser, auth } = require('../helpers');

beforeAll(connect);
afterEach(clear);
afterAll(disconnect);

const png = () => sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#a855f7' } }).png().toBuffer();

it('uploads, resizes and serves an image', async () => {
  const { token } = await createUser();
  const res = await request(app).post('/api/v1/uploads').set(auth(token))
    .attach('file', await png(), { filename: 'cover.png', contentType: 'image/png' });
  expect(res.status).toBe(201);

  const path = new URL(res.body.data.url).pathname;
  const img = await request(app).get(path);
  expect(img.status).toBe(200);
  expect(img.headers['content-type']).toBe('image/webp');
  expect(img.headers['cross-origin-resource-policy']).toBe('cross-origin');
  const meta = await sharp(img.body).metadata();
  expect(meta.width).toBe(1600);
});

it('rejects non-images and anonymous uploads', async () => {
  const { token } = await createUser();
  await request(app).post('/api/v1/uploads').set(auth(token))
    .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
  await request(app).post('/api/v1/uploads')
    .attach('file', await png(), { filename: 'cover.png', contentType: 'image/png' }).expect(401);
});

it('sets the profile photo', async () => {
  const { user, token } = await createUser();
  const res = await request(app).post('/api/v1/auth/upload-avatar').set(auth(token))
    .attach('profilePhoto', await png(), { filename: 'me.png', contentType: 'image/png' });
  expect(res.status).toBe(200);
  expect((await User.findById(user._id)).profilePhoto).toBe(res.body.data.profilePhoto);
});
