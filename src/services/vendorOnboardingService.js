const crypto = require('crypto');
const User = require('../models/User');
const Service = require('../models/Service');
const policies = require('../config/policies');
const ApiError = require('../utils/apiError');
const { frontendUrl } = require('../config/frontend');
const { hashToken, sanitizePhone } = require('../utils/helpers');

const CLAIM_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

// The first vendors to list, while founding terms are open, get them
exports.claimFoundingSpot = async (user) => {
  if (user.foundingVendor || !policies.foundingOpen()) return;
  const taken = await User.countDocuments({ foundingVendor: true });
  if (taken >= policies.foundingVendorLimit()) return;
  await User.updateOne({ _id: user._id, foundingVendor: { $ne: true } }, { foundingVendor: true, foundingVendorAt: new Date() });
};

/**
 * A link the vendor opens to set their password and take over the page an
 * admin set up for them. Replaces any earlier link.
 */
exports.claimLink = async (user) => {
  const token = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = hashToken(token);
  user.passwordResetExpires = Date.now() + CLAIM_DAYS * DAY;
  await user.save({ validateBeforeSave: false });
  return `${frontendUrl()}/auth/reset-password?token=${token}&welcome=1`;
};

/**
 * An admin lists a vendor from their intake form: creates their account and
 * first service, and returns the link to send them on WhatsApp.
 * @param {object} data - { name, email, phone, city, service: {...service fields} }
 * @param {object} admin
 */
exports.createVendor = async ({ name, email, phone, city, service }, admin) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPhone = phone ? sanitizePhone(String(phone)) : undefined;
  if (cleanPhone && !/^\+91[6-9]\d{9}$/.test(cleanPhone)) {
    throw new ApiError('Enter a 10-digit Indian mobile number', 400);
  }
  const clash = await User.findOne({ $or: [{ email: cleanEmail }, ...(cleanPhone ? [{ phone: cleanPhone }] : [])] }).select('email');
  if (clash) {
    throw new ApiError(clash.email === cleanEmail
      ? 'Someone already has a Festivo account with this email'
      : 'Someone already has a Festivo account with this phone number', 409);
  }

  const user = new User({
    name,
    email: cleanEmail,
    phone: cleanPhone,
    city,
    userType: 'helper',
    password: crypto.randomBytes(24).toString('hex'),
    emailVerified: false,
    onboardedBy: admin._id,
    acquisition: { source: 'admin_onboarding' }
  });
  await user.save();

  let listing;
  try {
    listing = await Service.create({ ...service, city: service.city || city, provider: user._id });
  } catch (error) {
    // Don't leave an account behind with nothing on it
    await User.deleteOne({ _id: user._id });
    throw error;
  }
  await exports.claimFoundingSpot(user);

  return { user, service: listing, claimUrl: await exports.claimLink(user) };
};
