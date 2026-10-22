const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const RSVP = require('../models/RSVP');
const Notification = require('../models/Notification');
const paymentService = require('./paymentService');
const policies = require('../config/policies');
const ApiError = require('../utils/apiError');

const round2 = (n) => Math.round(n * 100) / 100;

const ensureConfigured = () => {
  if (!paymentService.isConfigured()) {
    throw new ApiError('Online payments are not available right now', 503);
  }
};

const checkoutDetails = (payment, order) => ({
  paymentId: payment._id,
  orderId: order.id,
  amount: payment.amount,
  currency: payment.currency,
  keyId: process.env.RAZORPAY_KEY_ID
});

/**
 * Start an online payment toward a confirmed booking
 * @param {object} booking - Booking document
 * @param {number} [amount] - Partial (advance) amount; defaults to the full balance
 */
exports.createBookingOrder = async (booking, amount) => {
  ensureConfigured();

  const balance = round2(booking.priceAgreed - booking.pricePaid);
  if (balance < 1) {
    throw new ApiError('Nothing left to pay on this booking', 400);
  }

  const toPay = amount === undefined ? balance : round2(Number(amount));
  if (!(toPay >= 1) || toPay > balance) {
    throw new ApiError(`Amount must be between ₹1 and the balance of ₹${balance}`, 400);
  }

  const order = await paymentService.createOrder(toPay, `booking_${booking._id}`, {
    kind: 'booking',
    booking_id: booking._id.toString()
  });

  const payment = await Payment.create({
    kind: 'booking',
    booking: booking._id,
    event: booking.event,
    payer: booking.organizer,
    payee: booking.vendor,
    amount: toPay,
    feePercent: policies.bookingCommissionPercent(),
    razorpayOrderId: order.id
  });

  return checkoutDetails(payment, order);
};

/**
 * Start payment for a paid event ticket (attendee plus guests)
 * @param {object} rsvp - RSVP document in pending_payment status
 * @param {object} event - Event document
 */
exports.createTicketOrder = async (rsvp, event) => {
  ensureConfigured();

  const amount = round2(event.entryFee * (1 + (rsvp.guestsCount || 0)));
  const order = await paymentService.createOrder(amount, `ticket_${rsvp._id}`, {
    kind: 'ticket',
    rsvp_id: rsvp._id.toString()
  });

  const payment = await Payment.create({
    kind: 'ticket',
    rsvp: rsvp._id,
    event: event._id,
    payer: rsvp.attendee,
    payee: event.organizer,
    amount,
    feePercent: policies.ticketFeePercent(),
    razorpayOrderId: order.id
  });

  rsvp.razorpayOrderId = order.id;
  await rsvp.save();

  return checkoutDetails(payment, order);
};

/**
 * Record a successful Razorpay payment. Safe to call more than once for the
 * same order (browser verify and webhook both arrive): only the first call
 * applies the payment.
 */
exports.capturePayment = async ({ orderId, paymentId }) => {
  const payment = await Payment.findOneAndUpdate(
    { razorpayOrderId: orderId, status: { $in: ['created', 'failed'] } },
    { status: 'paid', razorpayPaymentId: paymentId, paidAt: new Date(), failureReason: null },
    { new: true }
  );

  if (!payment) {
    const existing = await Payment.findOne({ razorpayOrderId: orderId });
    if (!existing) {
      throw new ApiError('Payment order not found', 404);
    }
    return existing;
  }

  payment.recalculateSplit();
  await payment.save();

  if (payment.kind === 'booking') {
    await applyBookingPayment(payment);
  } else {
    await applyTicketPayment(payment);
  }

  return payment;
};

exports.markPaymentFailed = async ({ orderId, reason }) => {
  await Payment.updateOne(
    { razorpayOrderId: orderId, status: 'created' },
    { status: 'failed', failureReason: reason }
  );
};

const applyBookingPayment = async (payment) => {
  const booking = await Booking.findById(payment.booking);

  // Paid after the booking was cancelled: give the money back
  if (['cancelled', 'refunded'].includes(booking.status)) {
    await refundPayment(payment, 1, 'Booking was cancelled before payment completed');
    return;
  }

  booking.payments.push({
    amount: payment.amount,
    paymentMethod: 'razorpay',
    transactionId: payment.razorpayPaymentId,
    notes: 'Paid online through Festivo'
  });
  booking.paymentMethod = 'razorpay';
  booking.transactionId = payment.razorpayPaymentId;
  recalculateBookingTotals(booking);
  await booking.save();

  await Notification.createNotification({
    recipient: booking.vendor,
    type: 'payment',
    title: 'Payment Received',
    message: `₹${payment.amount} was paid online for your booking. Festivo releases it to you after the booking is completed.`,
    relatedBooking: booking._id,
    actionUrl: `/bookings/${booking._id}`
  });
};

const applyTicketPayment = async (payment) => {
  const rsvp = await RSVP.findById(payment.rsvp).populate('event', 'title organizer');

  if (!rsvp || rsvp.status === 'cancelled') {
    await refundPayment(payment, 1, 'RSVP was cancelled before payment completed');
    return;
  }

  rsvp.status = 'going';
  rsvp.paymentStatus = 'paid';
  rsvp.amountPaid = round2((rsvp.amountPaid || 0) + payment.amount);
  rsvp.razorpayPaymentId = payment.razorpayPaymentId;
  rsvp.transactionId = payment.razorpayPaymentId;
  await rsvp.save();

  await Notification.createNotification({
    recipient: rsvp.event.organizer,
    type: 'rsvp',
    title: 'Ticket Sold',
    message: `A ticket for "${rsvp.event.title}" was purchased (₹${payment.amount})`,
    relatedEvent: rsvp.event._id,
    relatedUser: rsvp.attendee,
    actionUrl: `/events/${rsvp.event._id}`
  });
};

// Derive booking payment totals and status from its payment records
const recalculateBookingTotals = (booking) => {
  const paid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
  booking.totalPaid = round2(paid);
  booking.pricePaid = round2(paid - (booking.refundedAmount || 0));

  if (booking.refundedAmount > 0 && booking.pricePaid <= 0) {
    booking.paymentStatus = 'refunded';
  } else if (booking.pricePaid >= booking.priceAgreed) {
    booking.paymentStatus = 'paid';
  } else if (booking.pricePaid > 0) {
    booking.paymentStatus = 'partial';
  } else {
    booking.paymentStatus = 'unpaid';
  }
};
exports.recalculateBookingTotals = recalculateBookingTotals;

/**
 * Refund a share of what remains refundable on a payment
 * @returns {Promise<number>} - Rupees refunded
 */
const refundPayment = async (payment, share, reason) => {
  const refundable = round2(payment.amount - payment.refundedAmount);
  const amount = round2(refundable * share);

  if (amount >= 1) {
    const refund = await paymentService.refund(payment.razorpayPaymentId, amount, { reason });
    payment.refunds.push({ razorpayRefundId: refund.id, amount, reason });
    payment.refundedAmount = round2(payment.refundedAmount + amount);
    payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
  }

  payment.recalculateSplit();
  await payment.save();
  return amount >= 1 ? amount : 0;
};

/**
 * Refund a share of a booking's online payments (used on cancellation).
 * Whatever isn't refunded becomes due to the vendor.
 * @returns {Promise<number>} - Rupees refunded
 */
exports.refundBookingPayments = async (booking, share, reason) => {
  const payments = await Payment.find({
    booking: booking._id,
    status: { $in: ['paid', 'partially_refunded'] }
  });

  let refunded = 0;
  for (const payment of payments) {
    refunded += await refundPayment(payment, share, reason);
    if (payment.payoutStatus === 'not_due' && payment.payeeAmount > 0) {
      payment.payoutStatus = 'pending';
      await payment.save();
    }
  }

  if (refunded > 0) {
    booking.refundedAmount = round2((booking.refundedAmount || 0) + refunded);
    recalculateBookingTotals(booking);
  }
  return round2(refunded);
};

/**
 * Refund a ticket's online payment
 * @returns {Promise<number>} - Rupees refunded
 */
exports.refundTicket = async (rsvp, share, reason) => {
  const payments = await Payment.find({
    rsvp: rsvp._id,
    status: { $in: ['paid', 'partially_refunded'] }
  });

  let refunded = 0;
  for (const payment of payments) {
    refunded += await refundPayment(payment, share, reason);
  }

  if (refunded > 0 && refunded >= rsvp.amountPaid) {
    rsvp.paymentStatus = 'refunded';
  }
  return round2(refunded);
};

// Booking completed: the vendor's share of its payments is now due
exports.releaseBookingPayouts = (bookingId) => Payment.updateMany(
  { booking: bookingId, status: { $in: ['paid', 'partially_refunded'] }, payoutStatus: 'not_due' },
  { payoutStatus: 'pending' }
);

// Event took place: the organizer's ticket revenue is now due
exports.releaseTicketPayouts = (eventId) => Payment.updateMany(
  { event: eventId, kind: 'ticket', status: { $in: ['paid', 'partially_refunded'] }, payoutStatus: 'not_due' },
  { payoutStatus: 'pending' }
);
