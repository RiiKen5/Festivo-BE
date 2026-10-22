const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Service = require('../src/models/Service');

let mongo;

const connect = async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
};

const clear = async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map(c => c.deleteMany({}))
  );
};

const disconnect = async () => {
  await mongoose.disconnect();
  await mongo.stop();
};

let counter = 0;

const createUser = async (overrides = {}) => {
  counter += 1;
  const user = await User.create({
    email: `user${counter}@example.com`,
    password: 'Password123!',
    name: `User ${counter}`,
    city: 'Pune',
    emailVerified: true,
    ...overrides
  });
  return { user, token: user.generateAccessToken() };
};

const createEvent = async (organizer, overrides = {}) => Event.create({
  title: 'Birthday Bash',
  description: 'A fun party',
  eventType: 'birthday',
  organizer: organizer._id,
  date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  time: '19:00',
  locationName: 'My place',
  address: '1 Main St',
  city: 'Pune',
  expectedGuests: 20,
  ...overrides
});

const createService = async (provider, overrides = {}) => Service.create({
  serviceName: 'Chocolate Cakes',
  provider: provider._id,
  category: 'food',
  description: 'Custom cakes',
  basePrice: 2000,
  priceUnit: 'per_event',
  city: 'Pune',
  ...overrides
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { connect, clear, disconnect, createUser, createEvent, createService, auth };
