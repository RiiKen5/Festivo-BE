const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // References
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Dates
  bookingDate: {
    type: Date,
    default: Date.now
  },
  eventDate: {
    type: Date,
    required: [true, 'Event date is required']
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'refunded'],
    default: 'pending'
  },

  // Payment
  priceAgreed: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },
  pricePaid: {
    type: Number,
    default: 0,
    min: 0
  },
  // totalPaid: everything received; pricePaid: what is kept after refunds
  totalPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  refundedAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial', 'paid', 'refunded'],
    default: 'unpaid'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'razorpay', 'other']
  },
  transactionId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,

  // Payment History
  payments: [{
    amount: {
      type: Number,
      required: true
    },
    paymentMethod: {
      type: String,
      // razorpay: paid online through the platform; others are recorded by the vendor
      enum: ['cash', 'upi', 'bank_transfer', 'card', 'netbanking', 'razorpay', 'other']
    },
    transactionId: String,
    paidAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],

  // Details
  notes: String,
  requirements: String,

  // Rating & Review (Post-completion)
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    maxlength: [1000, 'Review cannot exceed 1000 characters']
  },
  reviewDate: Date,
  // When the organizer was asked for a review, and reminded
  reviewRequestedAt: Date,
  reviewReminderSentAt: Date,

  // Communication
  lastMessageAt: Date,
  messageCount: {
    type: Number,
    default: 0
  },

  // Cancellation
  cancellationReason: String,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelledAt: Date,

  // Arrival: the organizer reads this code to the vendor, who enters it
  // when they arrive. Hidden from the vendor until then.
  arrivalCode: {
    type: String,
    select: false
  },
  arrivedAt: Date,
  arrivalAttempts: {
    type: Number,
    default: 0,
    select: false
  },

  // A problem the organizer reported (vendor didn't come, or didn't deliver
  // what was agreed). While open, the vendor's payout is frozen.
  dispute: {
    status: {
      type: String,
      enum: ['open', 'resolved']
    },
    reason: {
      type: String,
      enum: ['no_show', 'not_as_agreed', 'other']
    },
    details: {
      type: String,
      maxlength: [1000, 'Details cannot exceed 1000 characters']
    },
    openedAt: Date,
    // The vendor must answer by this time
    respondBy: Date,
    vendorResponse: {
      type: String,
      maxlength: [1000, 'Response cannot exceed 1000 characters']
    },
    vendorEvidence: [String],
    vendorRespondedAt: Date,
    // refund: organizer refunded in full; partial: part refunded; release: vendor paid
    resolution: {
      type: String,
      enum: ['refund', 'partial', 'release']
    },
    refunded: Number,
    noShow: Boolean,
    resolutionNote: String,
    resolvedAt: Date,
    // Empty when resolved automatically
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Completion
  completedAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
bookingSchema.index({ event: 1 });
bookingSchema.index({ service: 1 });
bookingSchema.index({ organizer: 1 });
bookingSchema.index({ vendor: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ eventDate: 1 });
bookingSchema.index({ paymentStatus: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ 'dispute.status': 1, 'dispute.respondBy': 1 });

// Four-digit arrival code, created when the vendor accepts
bookingSchema.pre('save', function(next) {
  if (this.status === 'confirmed' && !this.arrivalCode && this.isModified('status')) {
    this.arrivalCode = String(require('crypto').randomInt(0, 10000)).padStart(4, '0');
  }
  next();
});

// isNew/isModified are reset before post('save') runs, so record them here
bookingSchema.pre('save', function(next) {
  this.$locals.wasNew = this.isNew;
  this.$locals.statusChanged = this.isModified('status');
  next();
});

// Update service stats after booking
bookingSchema.post('save', async function() {
  const Service = mongoose.model('Service');

  if (this.$locals.wasNew) {
    await Service.findByIdAndUpdate(this.service, {
      $inc: { totalBookings: 1 }
    });
  }

  if (this.status === 'completed' && this.$locals.statusChanged) {
    await Service.findByIdAndUpdate(this.service, {
      $inc: { completedBookings: 1 }
    });
  }
});

// Virtual for payment balance
bookingSchema.virtual('paymentBalance').get(function() {
  return this.priceAgreed - this.pricePaid;
});

// Virtual populate messages
bookingSchema.virtual('messages', {
  ref: 'Message',
  localField: '_id',
  foreignField: 'relatedBooking'
});

module.exports = mongoose.model('Booking', bookingSchema);
