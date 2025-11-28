const crypto = require('crypto');

/**
 * Generate a random token
 * @param {number} bytes - Number of bytes
 * @returns {string} - Hex token
 */
exports.generateToken = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Hash a token using SHA256
 * @param {string} token - Token to hash
 * @returns {string} - Hashed token
 */
exports.hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Calculate pagination offset
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {number} - Offset value
 */
exports.calculateOffset = (page, limit) => {
  return (page - 1) * limit;
};

/**
 * Filter object to only include allowed fields
 * @param {object} obj - Object to filter
 * @param {array} allowedFields - Array of allowed field names
 * @returns {object} - Filtered object
 */
exports.filterObject = (obj, allowedFields) => {
  const filtered = {};
  Object.keys(obj).forEach(key => {
    if (allowedFields.includes(key)) {
      filtered[key] = obj[key];
    }
  });
  return filtered;
};

/**
 * Generate a slug from text
 * @param {string} text - Text to slugify
 * @returns {string} - Slug
 */
exports.generateSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
};

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} - Distance in kilometers
 */
exports.calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Format currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default INR)
 * @returns {string} - Formatted currency string
 */
exports.formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency
  }).format(amount);
};

/**
 * Check if a date is in the past
 * @param {Date} date - Date to check
 * @returns {boolean}
 */
exports.isPastDate = (date) => {
  return new Date(date) < new Date();
};

/**
 * Get days until a date
 * @param {Date} date - Target date
 * @returns {number} - Days until date (negative if past)
 */
exports.daysUntil = (date) => {
  const now = new Date();
  const target = new Date(date);
  const diff = target - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

/**
 * Sanitize phone number (India)
 * @param {string} phone - Phone number
 * @returns {string} - Sanitized phone number
 */
exports.sanitizePhone = (phone) => {
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');

  // If starts with 91 and has 12 digits, keep it
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return '+' + cleaned;
  }

  // If 10 digits, add +91
  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }

  return phone;
};
