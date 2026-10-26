const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Service = require('../models/Service');
const User = require('../models/User');
const Notification = require('../models/Notification');
const checkoutService = require('./checkoutService');
const chatService = require('./chatService');
const { dayKey } = require('./availabilityService');
const policies = require('../config/policies');
const ApiError = require('../utils/apiError');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_ARRIVAL_ATTEMPTS = 5;
const ACTIVE = ['confirmed', 'in_progress'];

const round2 = (n) => Math.round((n || 0) * 100) / 100;

const notify = (recipient, booking, title, message) => Notification.createNotification({
  recipient,
  type: 'booking',
  title,
  message,
  relatedBooking: booking._id,
  actionUrl: `/bookings/${booking._id}`
});

/**
 * Vendor enters the code the organizer gives them on arrival
 * @param {object} booking - Booking loaded with +arrivalCode
 */
exports.confirmArrival = async (booking, vendor, code, now = new Date()) => {
  if (!ACTIVE.includes(booking.status)) {
    throw new ApiError('Only accepted bookings can be checked in', 400);
  }
  if (booking.arrivedAt) {
    throw new ApiError('Your arrival is already confirmed', 400);
  }
  // Set-up often starts the day before (decor, venues)
  if (dayKey(now) < dayKey(new Date(booking.eventDate).getTime() - DAY)) {
    throw new ApiError('You can confirm your arrival from the day before the event', 400);
  }
  if ((booking.arrivalAttempts || 0) >= MAX_ARRIVAL_ATTEMPTS) {
    throw new ApiError('Too many wrong codes. Ask the organizer to mark you as arrived.', 429);
  }
  if (String(code || '').trim() !== booking.arrivalCode) {
    booking.arrivalAttempts = (booking.arrivalAttempts || 0) + 1;
    await booking.save();
    throw new ApiError('That code is not right. Ask the organizer for the 4-digit code on their booking page.', 400);
  }

  booking.arrivedAt = now;
  booking.status = 'in_progress';
  await booking.save();

  await notify(booking.organizer, booking, 'Vendor Arrived', 'Your vendor has arrived and entered your arrival code.');
  await chatService.postBookingUpdate(booking, vendor._id, 'Arrived. Arrival code confirmed.');
  return booking;
};

/**
 * Organizer reports a problem. Freezes the vendor's payout until resolved.
 */
exports.reportProblem = async (booking, organizer, { reason, details }, now = new Date()) => {
  if (!['no_show', 'not_as_agreed', 'other'].includes(reason)) {
    throw new ApiError('Please choose what went wrong', 400);
  }
  const text = typeof details === 'string' ? details.trim() : '';
  if (text.length < 10) {
    throw new ApiError('Please describe what happened in a few words', 400);
  }
  if (!ACTIVE.includes(booking.status)) {
    throw new ApiError(booking.status === 'completed'
      ? 'This booking is already complete. Email support if something went wrong.'
      : 'You can only report a problem on an accepted booking', 400);
  }
  if (booking.dispute && booking.dispute.status) {
    throw new ApiError('A problem was already reported on this booking', 400);
  }
  if (reason === 'no_show' && dayKey(now) < dayKey(booking.eventDate)) {
    throw new ApiError('You can report a no-show on the day of the event', 400);
  }
  if (reason === 'no_show' && booking.arrivedAt) {
    throw new ApiError('The vendor entered your arrival code, so they were marked as arrived. Choose another reason.', 400);
  }

  const respondBy = new Date(now.getTime() + policies.disputeResponseHours() * HOUR);
  booking.dispute = { status: 'open', reason, details: text, openedAt: now, respondBy };
  await booking.save();

  const what = reason === 'no_show' ? 'did not arrive' : 'did not deliver what was agreed';
  await notify(booking.vendor, booking, 'Problem Reported',
    `The organizer says you ${what}. Your payout is on hold. Reply with photos or proof within ${policies.disputeResponseHours()} hours, or they will be refunded.`);
  await chatService.postBookingUpdate(booking, organizer._id,
    `Reported a problem: ${text}`);
  return booking;
};

/**
 * Vendor answers a reported problem with their side and evidence
 */
exports.respond = async (booking, vendor, { response, evidence }) => {
  if (!booking.dispute || booking.dispute.status !== 'open') {
    throw new ApiError('There is no open problem on this booking', 400);
  }
  const text = typeof response === 'string' ? response.trim() : '';
  if (text.length < 10) {
    throw new ApiError('Please explain what happened in a few words', 400);
  }
  const photos = Array.isArray(evidence)
    ? evidence.filter(url => typeof url === 'string' && /^https?:\/\//.test(url)).slice(0, 6)
    : [];

  booking.dispute.vendorResponse = text;
  booking.dispute.vendorEvidence = photos;
  booking.dispute.vendorRespondedAt = new Date();
  await booking.save();

  await notify(booking.organizer, booking, 'Vendor Replied',
    'The vendor replied to the problem you reported. Festivo will review both sides and let you know.');
  await chatService.postBookingUpdate(booking, vendor._id, `Replied to the reported problem: ${text}`);
  return booking;
};

// Online money still refundable on a booking
const refundableOnline = async (bookingId) => {
  const payments = await Payment.find({ booking: bookingId, status: { $in: ['paid', 'partially_refunded'] } });
  return round2(payments.reduce((sum, p) => sum + p.amount - p.refundedAmount, 0));
};
exports.refundableOnline = refundableOnline;

/**
 * Settle a reported problem
 * @param {object} booking - Booking with an open dispute
 * @param {object|null} admin - Admin deciding; null when resolved automatically
 * @param {object} decision
 * @param {'refund'|'partial'|'release'} decision.resolution
 * @param {number} [decision.amount] - Rupees to refund for 'partial'
 * @param {boolean} [decision.noShow] - Record a verified no-show against the vendor
 * @param {number} [decision.penalty] - Rupees to deduct from the vendor's next payout
 * @param {string} [decision.note] - Explanation shown to both sides
 */
exports.resolve = async (booking, admin, { resolution, amount, noShow = false, penalty = 0, note }) => {
  if (!booking.dispute || booking.dispute.status !== 'open') {
    throw new ApiError('There is no open problem on this booking', 400);
  }
  if (!['refund', 'partial', 'release'].includes(resolution)) {
    throw new ApiError('Choose refund, partial refund or release', 400);
  }
  const penaltyAmount = round2(Number(penalty) || 0);
  if (penaltyAmount < 0) throw new ApiError('Penalty cannot be negative', 400);

  const refundable = await refundableOnline(booking._id);
  let refunded = 0;

  if (resolution === 'refund') {
    refunded = await checkoutService.refundBookingPayments(booking, 1, 'Refunded after a reported problem');
    booking.status = 'refunded';
  } else {
    if (resolution === 'partial') {
      const toRefund = round2(Number(amount));
      if (!(toRefund >= 1) || toRefund > refundable) {
        throw new ApiError(`Refund must be between ₹1 and ₹${refundable} (paid online)`, 400);
      }
      refunded = await checkoutService.refundBookingPayments(booking, toRefund / refundable, 'Partial refund after a reported problem');
    }
    booking.status = 'completed';
    booking.completedAt = new Date();
  }

  booking.dispute.status = 'resolved';
  booking.dispute.resolution = resolution;
  booking.dispute.refunded = refunded;
  booking.dispute.noShow = !!noShow;
  booking.dispute.resolutionNote = note;
  booking.dispute.resolvedAt = new Date();
  booking.dispute.resolvedBy = admin ? admin._id : undefined;
  await booking.save();

  if (booking.status === 'completed') {
    await checkoutService.releaseBookingPayouts(booking._id);
  }

  if (noShow || penaltyAmount > 0) {
    await User.findByIdAndUpdate(booking.vendor, {
      $inc: { noShowCount: noShow ? 1 : 0, penaltyDue: penaltyAmount }
    });
  }
  if (noShow) {
    await Service.updateMany({ provider: booking.vendor }, { $inc: { noShowCount: 1 } });
  }

  const outcome = {
    refund: `The organizer has been refunded${refunded ? ` ₹${refunded}` : ''}.`,
    partial: `₹${refunded} has been refunded to the organizer and the rest released to the vendor.`,
    release: 'The payment has been released to the vendor.'
  }[resolution];
  const why = note ? ` ${note}` : '';
  await notify(booking.organizer, booking, 'Problem Resolved', `${outcome}${why}`);
  await notify(booking.vendor, booking, 'Problem Resolved',
    `${outcome}${noShow ? ' This has been recorded as a no-show on your profile.' : ''}${penaltyAmount ? ` A ₹${penaltyAmount} penalty will be deducted from your next payout.` : ''}${why}`);

  return { booking, refunded };
};

/**
 * Vendors who don't answer in time lose the dispute: refund the organizer.
 * Arrival confirmed with the organizer's code goes to an admin instead.
 */
exports.resolveOverdue = async (now = new Date()) => {
  const overdue = await Booking.find({
    'dispute.status': 'open',
    'dispute.respondBy': { $lt: now },
    'dispute.vendorRespondedAt': { $exists: false },
    arrivedAt: { $exists: false }
  });

  let resolved = 0;
  for (const booking of overdue) {
    try {
      await exports.resolve(booking, null, {
        resolution: 'refund',
        noShow: booking.dispute.reason === 'no_show',
        note: 'The vendor did not reply in time.'
      });
      resolved++;
    } catch (error) {
      console.error(`[disputes] could not auto-resolve booking ${booking._id}:`, error.message);
    }
  }
  return resolved;
};
