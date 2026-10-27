const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Service = require('../models/Service');
const User = require('../models/User');
const Notification = require('../models/Notification');
const policies = require('../config/policies');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const round2 = (n) => Math.round((n || 0) * 100) / 100;

/**
 * Early release (Founding Vendor Plan): verified vendors get half their share
 * of what the customer paid, from 7 days before the event (or as soon as the
 * customer pays, if later). Sent within the payout promise.
 * @param {object} [options]
 * @param {string} [options.bookingId] - Only this booking (right after a payment)
 * @param {Date} [options.now]
 * @returns {Promise<number>} - Advances made due
 */
exports.releaseAdvances = async ({ bookingId, now = new Date() } = {}) => {
  const query = {
    status: { $in: ['confirmed', 'in_progress'] },
    eventDate: { $lte: new Date(now.getTime() + policies.earlyReleaseDays() * DAY) },
    'dispute.status': { $ne: 'open' }
  };
  if (bookingId) query._id = bookingId;
  const bookings = await Booking.find(query).select('service vendor');
  if (!bookings.length) return 0;

  const verified = new Set((await Service.find({
    _id: { $in: bookings.map(b => b.service) }, isVerified: true
  }).select('_id')).map(s => s._id.toString()));

  let released = 0;
  for (const booking of bookings.filter(b => verified.has(b.service.toString()))) {
    const payments = await Payment.find({
      booking: booking._id,
      status: { $in: ['paid', 'partially_refunded'] },
      payoutStatus: 'not_due',
      'advance.status': { $exists: false }
    });
    let total = 0;
    for (const payment of payments) {
      const amount = round2(payment.payeeAmount * policies.earlyReleaseShare());
      if (amount < 1) continue;
      payment.advance = { amount, status: 'pending', dueBy: new Date(now.getTime() + policies.payoutPromiseHours() * HOUR) };
      await payment.save();
      total += amount;
      released++;
    }
    if (total > 0) {
      await Notification.createNotification({
        recipient: booking.vendor,
        type: 'payment',
        title: 'Advance on its way',
        message: `₹${round2(total)} (half your share) will reach your account within ${policies.payoutPromiseHours()} hours, before the event.`,
        relatedBooking: booking._id,
        actionUrl: `/bookings/${booking._id}`
      });
    }
  }
  return released;
};

/**
 * After a refund: an advance not sent yet shrinks to what the vendor is
 * still owed; one already sent that the refund took back is recovered from
 * the vendor's future payouts.
 * @param {object} payment - Payment document, split already recalculated
 */
exports.settleAdvanceAfterRefund = async (payment) => {
  const advance = payment.advance;
  if (!advance || !advance.status) return;

  if (advance.status === 'pending') {
    advance.amount = round2(Math.min(advance.amount, Math.max(0, payment.payeeAmount)));
    if (advance.amount < 1) advance.status = 'cancelled';
    return;
  }

  if (advance.status === 'paid') {
    const shortfall = round2(Math.max(0, advance.amount - payment.payeeAmount));
    const owed = round2(shortfall - (payment.recoveredAmount || 0));
    if (owed > 0) {
      payment.recoveredAmount = round2((payment.recoveredAmount || 0) + owed);
      await User.updateOne({ _id: payment.payee }, { $inc: { penaltyDue: owed } });
    }
  }
};

// A reported problem stops an advance that hasn't been sent yet
exports.holdAdvances = (bookingId) => Payment.updateMany(
  { booking: bookingId, 'advance.status': 'pending' },
  { 'advance.status': 'cancelled' }
);

/**
 * Payouts waiting to be sent: early advances and final payouts, each with
 * the amount to send and its deadline
 */
exports.duePayouts = async ({ limit = 100 } = {}) => {
  const payments = await Payment.find({
    status: { $in: ['paid', 'partially_refunded', 'refunded'] },
    $or: [{ payoutStatus: 'pending' }, { 'advance.status': 'pending' }]
  })
    .populate('payee', 'name email phone penaltyDue noShowCount +payoutDetails')
    .populate('event', 'title date')
    .sort('createdAt')
    .limit(limit);

  const items = [];
  for (const p of payments) {
    const base = p.toObject();
    if (p.advance && p.advance.status === 'pending') {
      items.push({ ...base, part: 'advance', amountDue: p.advance.amount, dueBy: p.advance.dueBy });
    }
    if (p.payoutStatus === 'pending') {
      items.push({ ...base, part: 'final', amountDue: p.finalDue(), dueBy: p.payoutDueBy });
    }
  }
  return items.sort((a, b) => new Date(a.dueBy || 0) - new Date(b.dueBy || 0));
};

/**
 * Record that a payout was sent (UPI/bank transfer outside the app). Late
 * payouts waive Festivo's fee on that payment; penalties owed by the payee
 * are taken out of what is sent.
 * @returns {Promise<{payment: object, sent: number, deducted: number, feeWaived: boolean}|null>}
 */
exports.markSent = async (paymentId, { part = 'final', reference, admin, now = new Date() }) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) return null;

  const isAdvance = part === 'advance';
  if (isAdvance ? !(payment.advance && payment.advance.status === 'pending') : payment.payoutStatus !== 'pending') {
    return null;
  }

  const dueBy = isAdvance ? payment.advance.dueBy : payment.payoutDueBy;
  const late = !!(dueBy && now > dueBy && payment.kind === 'booking');
  if (late && !payment.feeWaived) {
    payment.feeWaived = true;
    payment.recalculateSplit();
  }

  const gross = isAdvance ? payment.advance.amount : payment.finalDue();
  const payee = await User.findById(payment.payee).select('penaltyDue');
  const deducted = round2(Math.min(payee ? payee.penaltyDue : 0, gross));
  const sent = round2(gross - deducted);

  if (isAdvance) {
    Object.assign(payment.advance, { status: 'paid', reference, paidAt: now, deducted });
  } else {
    Object.assign(payment, {
      payoutStatus: 'paid', payoutReference: reference, paidOutAt: now, paidOutBy: admin && admin._id,
      payoutAmount: sent, penaltyDeducted: deducted
    });
  }
  await payment.save();
  if (deducted > 0) {
    await User.updateOne({ _id: payment.payee }, { $inc: { penaltyDue: -deducted } });
  }

  return { payment, sent, deducted, feeWaived: late };
};

/**
 * A payee's money: held for upcoming jobs, due to be sent, and sent
 */
exports.earningsSummary = async (userId) => {
  const payments = await Payment.find({ payee: userId, status: { $in: ['paid', 'partially_refunded'] } });
  let held = 0;
  let payoutDue = 0;
  let paidOut = 0;
  for (const p of payments) {
    const advance = p.advance && p.advance.status;
    if (advance === 'paid') paidOut += p.advance.amount - (p.advance.deducted || 0);
    if (advance === 'pending') payoutDue += p.advance.amount;
    if (p.payoutStatus === 'paid') paidOut += typeof p.payoutAmount === 'number' ? p.payoutAmount : p.payeeAmount;
    else if (p.payoutStatus === 'pending') payoutDue += p.finalDue();
    else if (p.payoutStatus === 'not_due') held += p.payeeAmount - p.advanceSent() - (advance === 'pending' ? p.advance.amount : 0);
  }
  return { held: round2(held), payoutDue: round2(payoutDue), paidOut: round2(paidOut) };
};
