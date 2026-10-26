const expressRateLimit = require('express-rate-limit');

// The visitor's real address. In production the API sits behind Cloudflare
// and Render's load balancer, so req.ip is a proxy address shared by every
// visitor. Cloudflare sets CF-Connecting-IP / True-Client-IP itself
// (overwriting anything the client sends), so those identify the visitor.
const clientKey = (req) =>
  req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || req.ip || 'unknown';

// Limits are disabled in the test suite, which makes many requests from one IP.
// Health checks (Render pings it constantly) never count.
const rateLimit = (options) => expressRateLimit({
  skip: (req) => process.env.NODE_ENV === 'test' || req.path.endsWith('/health'),
  keyGenerator: clientKey,
  ...options
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // A single page view makes several API calls, and many users can share
  // one IP (college Wi-Fi, mobile carrier NAT)
  max: parseInt(process.env.API_RATE_LIMIT, 10) || 1000,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests from this IP, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Auth limiter (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // failed attempts per IP per window (successful ones aren't counted)
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many authentication attempts, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// File upload limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // uploads per IP per hour (a vendor portfolio is many images)
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_UPLOADS',
      message: 'Too many file uploads, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Create booking limiter
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 bookings per hour
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_BOOKINGS',
      message: 'Too many booking requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Message limiter
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 messages per minute
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_MESSAGES',
      message: 'Too many messages, please slow down'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// RSVPs without an account (public endpoint)
const guestRsvpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many RSVPs from this device, please try again later' }
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  clientKey,
  guestRsvpLimiter,
  apiLimiter,
  authLimiter,
  uploadLimiter,
  bookingLimiter,
  messageLimiter
};
