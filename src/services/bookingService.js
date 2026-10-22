const Notification = require('../models/Notification');
const checkoutService = require('./checkoutService');
const policies = require('../config/policies');

/**
 * Cancel a booking, refunding online payments according to the cancellation
 * policy, and notify the other party.
 * @param {object} booking - Booking document
 * @param {object} actor - User cancelling (organizer, vendor or admin)
 * @param {string} [reason]
 * @returns {Promise<number>} - Rupees refunded to the organizer
 */
exports.cancelBooking = async (booking, actor, reason) => {
  const byVendor = booking.vendor.toString() === actor._id.toString();
  const share = policies.bookingRefundShare(booking, byVendor);

  // Refund first: if Razorpay rejects the refund the booking stays active
  const refunded = await checkoutService.refundBookingPayments(
    booking,
    share,
    `Booking cancelled by ${byVendor ? 'vendor' : 'organizer'}`
  );

  booking.status = 'cancelled';
  booking.cancellationReason = reason;
  booking.cancelledBy = actor._id;
  booking.cancelledAt = new Date();
  await booking.save();

  const notifyUser = byVendor ? booking.organizer : booking.vendor;
  const refundNote = refunded > 0 ? ` ₹${refunded} has been refunded to the organizer.` : '';

  await Notification.createNotification({
    recipient: notifyUser,
    type: 'booking',
    title: 'Booking Cancelled',
    message: `A booking has been cancelled. Reason: ${reason || 'No reason provided'}.${refundNote}`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });

  return refunded;
};
