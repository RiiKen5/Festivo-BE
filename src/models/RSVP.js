const mongoose = require('mongoose');

const rsvpSchema = new mongoose.Schema({
  // References
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  attendee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // RSVP Status
  status: {
    type: String,
    enum: ['going', 'maybe', 'not_going', 'cancelled'],
    default: 'going'
  },
  guestsCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },

  // Payment (if paid event)
  amountPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'refunded'],
    default: 'unpaid'
  },
  transactionId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,

  // Check-in
  checkedIn: {
    type: Boolean,
    default: false
  },
  checkedInAt: Date,
  checkInCode: String,

  // Post-event
  attended: Boolean,
  eventRating: {
    type: Number,
    min: 1,
    max: 5
  },
  eventReview: {
    type: String,
    maxlength: [500, 'Review cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate RSVPs
rsvpSchema.index({ event: 1, attendee: 1 }, { unique: true });
rsvpSchema.index({ event: 1, status: 1 });
rsvpSchema.index({ createdAt: -1 });

// Update event attendee count
rsvpSchema.post('save', async function() {
  const Event = mongoose.model('Event');

  const rsvpCount = await this.constructor.countDocuments({
    event: this.event,
    status: 'going'
  });

  await Event.findByIdAndUpdate(this.event, {
    currentAttendees: rsvpCount,
    rsvpCount: rsvpCount
  });
});

// Also update on deletion
rsvpSchema.post('deleteOne', { document: true, query: false }, async function() {
  const Event = mongoose.model('Event');

  const rsvpCount = await this.constructor.countDocuments({
    event: this.event,
    status: 'going'
  });

  await Event.findByIdAndUpdate(this.event, {
    currentAttendees: rsvpCount,
    rsvpCount: rsvpCount
  });
});

// Generate check-in code before saving
rsvpSchema.pre('save', function(next) {
  if (this.isNew && !this.checkInCode) {
    this.checkInCode = `${this.event.toString().substr(-6)}-${this.attendee.toString().substr(-6)}`.toUpperCase();
  }
  next();
});

// Update user stats when attended
rsvpSchema.post('save', async function() {
  if (this.attended && this.isModified('attended')) {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(this.attendee, {
      $inc: { eventsAttended: 1, xpPoints: 20 }
    });
  }
});

// Static method to get event attendees
rsvpSchema.statics.getEventAttendees = function(eventId) {
  return this.find({ event: eventId, status: 'going' })
    .populate('attendee', 'name profilePhoto email')
    .sort({ createdAt: -1 });
};

// Static method to check if user already RSVPed
rsvpSchema.statics.hasRSVPed = function(eventId, userId) {
  return this.findOne({ event: eventId, attendee: userId });
};

module.exports = mongoose.model('RSVP', rsvpSchema);
