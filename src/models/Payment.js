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
  this.platformFee = Math.round(retained * this.feePercent) / 100;
  this.payeeAmount = Math.round((retained - this.platformFee) * 100) / 100;
  if (retained <= 0) this.payoutStatus = 'not_applicable';
};

module.exports = mongoose.model('Payment', paymentSchema);
