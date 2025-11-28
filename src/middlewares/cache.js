const redis = require('../config/redis');

/**
 * Cache middleware for GET requests
 * @param {number} duration - Cache duration in seconds (default 5 minutes)
 */
const cache = (duration = 300) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.originalUrl}`;

    try {
      const cachedResponse = await redis.get(key);

      if (cachedResponse) {
        return res.json(JSON.parse(cachedResponse));
      }

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache the response
      res.json = (data) => {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(key, duration, JSON.stringify(data));
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

/**
 * Clear cache by pattern
 * @param {string} pattern - Pattern to match cache keys
 */
const clearCache = async (pattern) => {
  try {
    const stream = redis.scanStream({
      match: `cache:${pattern}*`
    });

    const pipeline = redis.pipeline();

    return new Promise((resolve, reject) => {
      stream.on('data', (keys) => {
        if (keys.length) {
          keys.forEach((key) => {
            pipeline.del(key);
          });
        }
      });

      stream.on('end', async () => {
        await pipeline.exec();
        resolve();
      });

      stream.on('error', reject);
    });
  } catch (error) {
    console.error('Clear cache error:', error);
  }
};

/**
 * Clear specific cache key
 * @param {string} key - Cache key to clear
 */
const clearCacheKey = async (key) => {
  try {
    await redis.del(`cache:${key}`);
  } catch (error) {
    console.error('Clear cache key error:', error);
  }
};

/**
 * User-specific cache middleware
 * @param {number} duration - Cache duration in seconds
 */
const userCache = (duration = 300) => {
  return async (req, res, next) => {
    if (req.method !== 'GET' || !req.user) {
      return next();
    }

    const key = `cache:user:${req.user._id}:${req.originalUrl}`;

    try {
      const cachedResponse = await redis.get(key);

      if (cachedResponse) {
        return res.json(JSON.parse(cachedResponse));
      }

      const originalJson = res.json.bind(res);

      res.json = (data) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(key, duration, JSON.stringify(data));
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('User cache middleware error:', error);
      next();
    }
  };
};

/**
 * Clear user-specific cache
 * @param {string} userId - User ID
 */
const clearUserCache = async (userId) => {
  try {
    await clearCache(`user:${userId}`);
  } catch (error) {
    console.error('Clear user cache error:', error);
  }
};

module.exports = {
  cache,
  clearCache,
  clearCacheKey,
  userCache,
  clearUserCache
};
