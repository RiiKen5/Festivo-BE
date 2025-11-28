const emailService = require('./emailService');
const smsService = require('./smsService');
const uploadService = require('./uploadService');
const paymentService = require('./paymentService');
const cacheService = require('./cacheService');

module.exports = {
  emailService,
  smsService,
  uploadService,
  paymentService,
  cacheService
};
