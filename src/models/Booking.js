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
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial', 'paid', 'refunded'],
    default: 'unpaid'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking']
  },
  transactionId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,

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

// Update service stats after booking
bookingSchema.post('save', async function() {
  const Service = mongoose.model('Service');

  if (this.isNew) {
    await Service.findByIdAndUpdate(this.service, {
      $inc: { totalBookings: 1 }
    });
  }

  if (this.status === 'completed' && this.isModified('status')) {
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
