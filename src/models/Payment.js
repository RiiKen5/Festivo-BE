const mongoose = require('mongoose');

// One online payment collected through Razorpay, and what the platform owes
// the payee for it. This is the ledger for commission and payouts.
const paymentSchema = new mongoose.Schema({
  kind: {
    type: String,
    enum: ['booking', 'ticket'],
    required: true
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  rsvp: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RSVP'
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },

  // Who paid, and who the money is ultimately for (vendor or event organizer)
  // Empty for tickets bought without an account
  payer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [function() { return this.kind === 'booking'; }, 'Payer is required']
  },
  payee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Amounts in rupees
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  feePercent: {
    type: Number,
    required: true
  },
  // Most Festivo may take from this payment (the booking's fee cap, less
  // fees already taken on its other payments)
  feeCap: Number,
  // Payout promise broken (sent late): no Festivo fee on this payment
  feeWaived: {
    type: Boolean,
    default: false
  },
  // Platform fee and payee share of the amount retained after refunds
  platformFee: {
    type: Number,
    default: 0
  },
  payeeAmount: {
    type: Number,
    default: 0
  },
  refundedAmount: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },

  status: {
    type: String,
    enum: ['created', 'paid', 'failed', 'refunded', 'partially_refunded'],
    default: 'created'
  },
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true
  },
  razorpayPaymentId: String,
  paidAt: Date,
  failureReason: String,

  refunds: [{
    razorpayRefundId: String,
    amount: Number,
    reason: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Payout of payeeAmount to the vendor/organizer. Becomes due once the
  // booking is completed or the event has taken place.
  payoutStatus: {
    type: String,
    enum: ['not_due', 'pending', 'paid', 'not_applicable'],
    default: 'not_due'
  },
  payoutReference: String,
  // The final payout must be sent by this time (bookings)
  payoutDueBy: Date,
  // What the final payout actually sent, after any early release and penalty
  payoutAmount: Number,

  // Early release: part of the vendor's share sent before the event
  advance: {
    amount: Number,
    // cancelled: not sent (a problem was reported, or the job finished first)
    status: {
      type: String,
      enum: ['pending', 'paid', 'cancelled']
    },
    dueBy: Date,
    reference: String,
    paidAt: Date,
    // Penalty or recovered money taken out of this advance
    deducted: Number
  },
  // Money sent early that a later refund took back, added to the vendor's
  // penaltyDue so it is recovered from future payouts
  recoveredAmount: {
    type: Number,
    default: 0
  },
  // No-show penalty owed by the payee, taken out of this payout
  penaltyDeducted: {
    type: Number,
    default: 0
  },
  paidOutAt: Date,
  paidOutBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

paymentSchema.index({ booking: 1 });
paymentSchema.index({ rsvp: 1 });
paymentSchema.index({ event: 1 });
paymentSchema.index({ payer: 1, createdAt: -1 });
paymentSchema.index({ payee: 1, createdAt: -1 });
paymentSchema.index({ status: 1, payoutStatus: 1 });

// Recompute fee and payee share from the amount kept after refunds
paymentSchema.methods.recalculateSplit = function() {
  const retained = this.amount - this.refundedAmount;
  let fee = this.feeWaived ? 0 : Math.round(retained * this.feePercent) / 100;
  if (typeof this.feeCap === 'number') fee = Math.min(fee, Math.max(0, this.feeCap));
  this.platformFee = fee;
  this.payeeAmount = Math.round((retained - fee) * 100) / 100;
  if (retained <= 0) this.payoutStatus = 'not_applicable';
};

// Sent, or about to be sent, before the event
paymentSchema.methods.advanceSent = function() {
  return this.advance && this.advance.status === 'paid' ? this.advance.amount : 0;
};

// What the final payout still owes the payee
paymentSchema.methods.finalDue = function() {
  return Math.max(0, Math.round((this.payeeAmount - this.advanceSent()) * 100) / 100);
};

module.exports = mongoose.model('Payment', paymentSchema);
