const redis = require('../config/redis');

class CacheService {
  constructor() {
    this.client = redis;
    this.defaultTTL = 300; // 5 minutes
  }

  // Generate cache key
  generateKey(prefix, ...parts) {
    return `${prefix}:${parts.join(':')}`;
  }

  // Set cache with optional TTL
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  // Get from cache
  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  // Delete from cache
  async delete(key) {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  // Delete by pattern
  async deletePattern(pattern) {
    try {
      const stream = this.client.scanStream({ match: pattern });
      const pipeline = this.client.pipeline();

      return new Promise((resolve, reject) => {
        stream.on('data', (keys) => {
          if (keys.length) {
            keys.forEach(key => pipeline.del(key));
          }
        });

        stream.on('end', async () => {
          await pipeline.exec();
          resolve(true);
        });

        stream.on('error', reject);
      });
    } catch (error) {
      console.error('Cache delete pattern error:', error);
      return false;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  // Set with expiration at specific time
  async setExpiresAt(key, value, timestamp) {
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized);
      await this.client.expireat(key, Math.floor(timestamp / 1000));
      return true;
    } catch (error) {
      console.error('Cache setExpiresAt error:', error);
      return false;
    }
  }

  // Increment counter
  async increment(key, amount = 1) {
    try {
      return await this.client.incrby(key, amount);
    } catch (error) {
      console.error('Cache increment error:', error);
      return null;
    }
  }

  // Decrement counter
  async decrement(key, amount = 1) {
    try {
      return await this.client.decrby(key, amount);
    } catch (error) {
      console.error('Cache decrement error:', error);
      return null;
    }
  }

  // Hash operations
  async hSet(key, field, value) {
    try {
      await this.client.hset(key, field, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache hSet error:', error);
      return false;
    }
  }

  async hGet(key, field) {
    try {
      const data = await this.client.hget(key, field);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache hGet error:', error);
      return null;
    }
  }

  async hGetAll(key) {
    try {
      const data = await this.client.hgetall(key);
      if (!data) return null;

      const result = {};
      for (const [field, value] of Object.entries(data)) {
        result[field] = JSON.parse(value);
      }
      return result;
    } catch (error) {
      console.error('Cache hGetAll error:', error);
      return null;
    }
  }

  // List operations
  async listPush(key, value) {
    try {
      await this.client.lpush(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache listPush error:', error);
      return false;
    }
  }

  async listRange(key, start = 0, end = -1) {
    try {
      const data = await this.client.lrange(key, start, end);
      return data.map(item => JSON.parse(item));
    } catch (error) {
      console.error('Cache listRange error:', error);
      return [];
    }
  }

  // Set operations
  async setAdd(key, ...values) {
    try {
      const serialized = values.map(v => JSON.stringify(v));
      await this.client.sadd(key, ...serialized);
      return true;
    } catch (error) {
      console.error('Cache setAdd error:', error);
      return false;
    }
  }

  async setMembers(key) {
    try {
      const data = await this.client.smembers(key);
      return data.map(item => JSON.parse(item));
    } catch (error) {
      console.error('Cache setMembers error:', error);
      return [];
    }
  }

  async setIsMember(key, value) {
    try {
      return await this.client.sismember(key, JSON.stringify(value));
    } catch (error) {
      console.error('Cache setIsMember error:', error);
      return false;
    }
  }

  // Cache wrapper for functions
  async cacheWrapper(key, fn, ttl = this.defaultTTL) {
    const cached = await this.get(key);
    if (cached) return cached;

    const result = await fn();
    await this.set(key, result, ttl);
    return result;
  }

  // Get TTL of a key
  async getTTL(key) {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error('Cache getTTL error:', error);
      return -1;
    }
  }

  // Refresh TTL
  async refreshTTL(key, ttl = this.defaultTTL) {
    try {
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      console.error('Cache refreshTTL error:', error);
      return false;
    }
  }

  // Clear all cache (use with caution)
  async flushAll() {
    try {
      await this.client.flushall();
      return true;
    } catch (error) {
      console.error('Cache flushAll error:', error);
      return false;
    }
  }
}

module.exports = new CacheService();
