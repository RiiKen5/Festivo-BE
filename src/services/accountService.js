const crypto = require('crypto');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const RSVP = require('../models/RSVP');
const Service = require('../models/Service');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const bookingService = require('./bookingService');
const ApiError = require('../utils/apiError');

const round2 = (n) => Math.round((n || 0) * 100) / 100;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * What stops this account being deleted right now: anything where money or
 * other people still depend on it. Each reason says what to do first.
 * @returns {Promise<string[]>}
 */
exports.deletionBlockers = async (userId) => {
  const [activeBookings, upcomingEvents, paidTickets, owedToUser, user] = await Promise.all([
    Booking.countDocuments({
      $or: [{ organizer: userId }, { vendor: userId }],
      status: { $in: ['confirmed', 'in_progress'] }
    }),
    Event.countDocuments({
      organizer: userId,
      status: { $nin: ['cancelled', 'completed'] },
      date: { $gte: startOfToday() }
    }),
    RSVP.find({ attendee: userId, status: 'going', paymentStatus: 'paid' })
      .populate({ path: 'event', select: 'date', match: { date: { $gte: startOfToday() } } })
      .then(rsvps => rsvps.filter(r => r.event).length),
    Payment.find({
      payee: userId,
      status: { $in: ['paid', 'partially_refunded'] },
      $or: [{ payoutStatus: { $in: ['not_due', 'pending'] } }, { 'advance.status': 'pending' }]
    }).then(payments => round2(payments.reduce((sum, p) => sum + p.finalDue(), 0))),
    User.findById(userId).select('penaltyDue')
  ]);

  const blockers = [];
  if (activeBookings) {
    blockers.push(`You have ${activeBookings} accepted booking(s). Complete or cancel them first.`);
  }
  if (upcomingEvents) {
    blockers.push(`You have ${upcomingEvents} upcoming event(s). Cancel them first, so your guests are told.`);
  }
  if (paidTickets) {
    blockers.push(`You have ${paidTickets} ticket(s) for upcoming events. Cancel them first to get any refund.`);
  }
  if (owedToUser > 0) {
    blockers.push(`Festivo still owes you ₹${owedToUser}. Wait until it has been paid out to you.`);
  }
  if (user && user.penaltyDue > 0) {
    blockers.push(`You owe Festivo ₹${round2(user.penaltyDue)}. Contact us to settle it first.`);
  }
  return blockers;
};

/**
 * Delete an account: erase personal details, take listings down, cancel
 * open requests and free RSVPs, and sign out everywhere. Bookings, payments
 * and messages stay (other people and the accounts need them) but show
 * "Deleted user".
 */
exports.deleteAccount = async (userId) => {
  const blockers = await exports.deletionBlockers(userId);
  if (blockers.length) {
    throw new ApiError(blockers.join(' '), 409, { blockers });
  }

  const user = await User.findById(userId).select('+refreshTokens');
  if (!user || user.deletedAt) {
    throw new ApiError('Account not found', 404);
  }

  // Booking requests not yet accepted: nothing has been paid
  const pending = await Booking.find({ $or: [{ organizer: userId }, { vendor: userId }], status: 'pending' });
  for (const booking of pending) {
    await bookingService.cancelBooking(booking, user, 'Account deleted');
  }

  await Service.updateMany({ provider: userId }, { isActive: false });
  await RSVP.updateMany(
    { attendee: userId, status: { $in: ['going', 'maybe', 'pending_payment'] }, paymentStatus: { $ne: 'paid' } },
    { status: 'cancelled' }
  );
  await Notification.deleteMany({ recipient: userId });

  user.set({
    name: 'Deleted user',
    email: `deleted-${user._id}@deleted.festivo.invalid`,
    password: crypto.randomBytes(32).toString('hex'),
    profilePhoto: null,
    refreshTokens: [],
    isActive: false,
    deletedAt: new Date()
  });
  for (const field of ['phone', 'googleId', 'bio', 'location', 'payoutDetails', 'socialLinks', 'acquisition',
    'passwordResetToken', 'emailVerificationToken', 'phoneOTP']) {
    user.set(field, undefined);
  }
  await user.save({ validateBeforeSave: false });

  // Events already over keep their history, without the organizer's details
  return { cancelledRequests: pending.length };
};
