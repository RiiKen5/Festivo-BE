const Booking = require('../models/Booking');
const RSVP = require('../models/RSVP');
const Event = require('../models/Event');
const Payment = require('../models/Payment');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const ApiResponse = require('../utils/apiResponse');
const paymentService = require('../services/paymentService');
const checkoutService = require('../services/checkoutService');
const policies = require('../config/policies');
const { hashToken } = require('../utils/helpers');

// @desc    Public payment settings for the checkout UI
// @route   GET /api/v1/payments/config
// @access  Public
exports.getConfig = (req, res) => {
  res.json(ApiResponse.success({
    enabled: paymentService.isConfigured(),
    keyId: process.env.RAZORPAY_KEY_ID || null,
    ticketFeePercent: policies.ticketFeePercent(),
    bookingFees: {
      ownPercent: policies.bookingFeePercent({ source: 'vendor_link', founding: false }),
      newPercent: policies.bookingFeePercent({ source: 'marketplace', founding: false }),
      foundingOwnPercent: policies.bookingFeePercent({ source: 'vendor_link', founding: true }),
      foundingNewPercent: policies.bookingFeePercent({ source: 'marketplace', founding: true }),
      cap: policies.bookingFeeCap(),
      foundingUntil: policies.foundingUntil(),
      foundingOpen: policies.foundingOpen(),
      earlyReleaseDays: policies.earlyReleaseDays(),
      payoutPromiseHours: policies.payoutPromiseHours()
    }
  }, 'Payment config retrieved'));
};

// @desc    Start an online payment for a confirmed booking
// @route   POST /api/v1/payments/bookings/:id/order
// @access  Private (organizer)
exports.createBookingOrder = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new ApiError('Booking not found', 404));
  }

  if (booking.organizer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Only the organizer can pay for this booking', 403));
  }

  if (!['confirmed', 'in_progress'].includes(booking.status)) {
    return next(new ApiError('You can pay once the vendor has confirmed the booking', 400));
  }

  const checkout = await checkoutService.createBookingOrder(booking, req.body.amount);
  res.status(201).json(ApiResponse.success(checkout, 'Payment order created'));
});

// @desc    Retry payment for a ticket awaiting payment
// @route   POST /api/v1/payments/rsvps/:id/order
// @access  Private (attendee)
exports.createTicketOrder = catchAsync(async (req, res, next) => {
  const rsvp = await RSVP.findById(req.params.id);

  if (!rsvp || String(rsvp.attendee) !== String(req.user._id)) {
    return next(new ApiError('RSVP not found', 404));
  }

  if (rsvp.status !== 'pending_payment') {
    return next(new ApiError('This RSVP is not awaiting payment', 400));
  }

  const event = await Event.findById(rsvp.event);
  if (!event || ['cancelled', 'completed'].includes(event.status)) {
    return next(new ApiError('This event is no longer selling tickets', 400));
  }

  if (event.maxAttendees && event.currentAttendees + 1 + rsvp.guestsCount > event.maxAttendees) {
    return next(new ApiError('Event is at full capacity', 400));
  }

  const checkout = await checkoutService.createTicketOrder(rsvp, event);
  res.status(201).json(ApiResponse.success(checkout, 'Payment order created'));
});

// @desc    Confirm a payment after Razorpay Checkout succeeds
// @route   POST /api/v1/payments/verify
// @access  Private
exports.verifyPayment = catchAsync(async (req, res, next) => {
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  } = req.body;

  if (!paymentService.verifyPaymentSignature(orderId, paymentId, signature)) {
    return next(new ApiError('Payment verification failed', 400));
  }

  const existing = await Payment.findOne({ razorpayOrderId: orderId });
  if (!existing || !existing.payer || existing.payer.toString() !== req.user._id.toString()) {
    return next(new ApiError('Payment order not found', 404));
  }

  const payment = await checkoutService.capturePayment({ orderId, paymentId });
  res.json(ApiResponse.success(payment, 'Payment successful'));
});

// @desc    Confirm a ticket payment made without an account
// @route   POST /api/v1/payments/guest/verify
// @access  Public (the guest's private RSVP token proves ownership)
exports.verifyGuestPayment = catchAsync(async (req, res, next) => {
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    guestToken
  } = req.body;

  if (!paymentService.verifyPaymentSignature(orderId, paymentId, signature)) {
    return next(new ApiError('Payment verification failed', 400));
  }

  const existing = await Payment.findOne({ razorpayOrderId: orderId, kind: 'ticket' });
  const rsvp = existing && typeof guestToken === 'string' &&
    await RSVP.findOne({ _id: existing.rsvp, guestTokenHash: hashToken(guestToken) });
  if (!rsvp) {
    return next(new ApiError('Payment order not found', 404));
  }

  await checkoutService.capturePayment({ orderId, paymentId });
  res.json(ApiResponse.success({ status: 'paid' }, 'Payment successful'));
});

// @desc    Razorpay webhook (backup for when the browser never calls verify)
// @route   POST /api/v1/payments/webhook
// @access  Razorpay (signature checked); mounted with a raw body parser
exports.handleWebhook = catchAsync(async (req, res, next) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!Buffer.isBuffer(req.body) || !paymentService.verifyWebhookSignature(req.body, signature)) {
    return next(new ApiError('Invalid webhook signature', 400));
  }

  const { event, payload } = JSON.parse(req.body.toString('utf8'));
  const entity = payload && payload.payment && payload.payment.entity;

  if (entity && entity.order_id) {
    const known = await Payment.exists({ razorpayOrderId: entity.order_id });
    if (known) {
      if (event === 'payment.captured' || event === 'order.paid') {
        await checkoutService.capturePayment({ orderId: entity.order_id, paymentId: entity.id });
      } else if (event === 'payment.failed') {
        await checkoutService.markPaymentFailed({
          orderId: entity.order_id,
          reason: entity.error_description || 'Payment failed'
        });
      }
    }
  }

  // Always acknowledge so Razorpay doesn't retry events we don't handle
  res.json({ received: true });
});

// @desc    Payments I made, or earnings owed/paid to me
// @route   GET /api/v1/payments/mine?role=payer|payee
// @access  Private
exports.getMyPayments = catchAsync(async (req, res, next) => {
  const { role = 'payer', page = 1, limit = 20 } = req.query;
  const query = {
    [role === 'payee' ? 'payee' : 'payer']: req.user._id,
    status: { $ne: 'created' }
  };

  const [payments, total, summary] = await Promise.all([
    Payment.find(query)
      .populate('event', 'title date')
      .populate('booking', 'service')
      .sort('-createdAt')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean(),
    Payment.countDocuments(query),
    role === 'payee' ? require('../services/payoutService').earningsSummary(req.user._id) : null
  ]);

  res.json({
    ...ApiResponse.paginated(payments, page, limit, total, 'Payments retrieved'),
    summary
  });
});
