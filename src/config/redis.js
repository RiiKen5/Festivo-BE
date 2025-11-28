const Redis = require('ioredis');

let redisClient = null;
let redisEnabled = false;

// Mock Redis client for when Redis is not available
const mockRedisClient = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 1,
  exists: async () => 0,
  expire: async () => 1,
  ttl: async () => -1,
  hset: async () => 1,
  hget: async () => null,
  hgetall: async () => null,
  lpush: async () => 1,
  lrange: async () => [],
  sadd: async () => 1,
  smembers: async () => [],
  sismember: async () => 0,
  incrby: async () => 1,
  decrby: async () => 0,
  flushall: async () => 'OK',
  scanStream: () => {
    const EventEmitter = require('events');
    const stream = new EventEmitter();
    setTimeout(() => {
      stream.emit('data', []);
      stream.emit('end');
    }, 0);
    return stream;
  },
  pipeline: () => ({
    del: () => {},
    exec: async () => []
  }),
  on: () => {},
  status: 'mock'
};

const createRedisClient = () => {
  if (redisClient) {
    return redisClient;
  }

  // Check if Redis should be disabled
  if (process.env.REDIS_ENABLED === 'false') {
    console.log('Redis disabled by configuration, using mock client');
    redisClient = mockRedisClient;
    return redisClient;
  }

  try {
    const client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        if (times > 3) {
          console.log('Redis connection failed after 3 attempts, using mock client');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 1000);
      },
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false
    });

    client.on('connect', () => {
      console.log('Redis connected');
      redisEnabled = true;
    });

    client.on('error', (err) => {
      if (!redisEnabled) {
        // Only log once, then switch to mock
        console.warn('Redis unavailable, caching disabled:', err.message);
      }
    });

    client.on('ready', () => {
      console.log('Redis is ready');
      redisEnabled = true;
    });

    client.on('end', () => {
      redisEnabled = false;
    });

    // Try to connect
    client.connect().catch(() => {
      console.log('Redis not available, using mock client (caching disabled)');
      redisClient = mockRedisClient;
    });

    redisClient = client;
    return redisClient;
  } catch (error) {
    console.warn('Redis initialization failed, using mock client:', error.message);
    redisClient = mockRedisClient;
    return redisClient;
  }
};

// Export both the client and a function to check if Redis is enabled
module.exports = createRedisClient();
module.exports.isRedisEnabled = () => redisEnabled;
