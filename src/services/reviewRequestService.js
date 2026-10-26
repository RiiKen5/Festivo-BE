const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const emailService = require('./emailService');
const { frontendUrl } = require('../config/frontend');

const DAY = 24 * 60 * 60 * 1000;
const REMINDER_AFTER_DAYS = 3;

/**
 * Ask the organizer to review the vendor once a booking is completed, so new
 * vendors get their first reviews. Never fails the caller.
 * @param {string|object} bookingId
 * @param {{ reminder?: boolean }} [opts]
 */
exports.requestReview = async (bookingId, { reminder = false } = {}) => {
  try {
    const booking = await Booking.findById(bookingId)
      .populate('service', 'serviceName')
      .populate('organizer', 'name email notifications')
      .populate('vendor', 'name');
    if (!booking || booking.status !== 'completed' || !booking.organizer) return;
    if (await Review.exists({ booking: booking._id })) return;

    const vendorName = booking.vendor?.name || booking.service?.serviceName || 'your vendor';
    const link = `${frontendUrl()}/bookings/${booking._id}?review=1`;

    await Notification.createNotification({
      recipient: booking.organizer._id,
      type: 'review',
      title: reminder ? `Still time to review ${vendorName}` : `How was ${vendorName}?`,
      message: 'A short review helps other people choose, and helps good vendors get more bookings.',
      relatedBooking: booking._id,
      actionUrl: `/bookings/${booking._id}?review=1`
    });

    if (booking.organizer.email && booking.organizer.notifications?.email !== false) {
      await emailService.sendReviewRequest(booking.organizer, vendorName, booking.service?.serviceName, link, reminder)
        .catch(err => console.error('Review request email failed:', err.message));
    }

    booking.set(reminder ? 'reviewReminderSentAt' : 'reviewRequestedAt', new Date());
    await booking.save({ validateBeforeSave: false });
  } catch (error) {
    console.error('Could not request a review:', error.message);
  }
};

/** One reminder, a few days after the first ask, for bookings still unreviewed. */
exports.sendDueReminders = async (now = new Date()) => {
  const due = await Booking.find({
    status: 'completed',
    reviewRequestedAt: { $lte: new Date(now - REMINDER_AFTER_DAYS * DAY) },
    reviewReminderSentAt: { $exists: false }
  }).select('_id').limit(200).lean();
  for (const b of due) await exports.requestReview(b._id, { reminder: true });
  return due.length;
};
