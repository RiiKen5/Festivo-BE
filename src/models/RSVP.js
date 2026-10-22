const crypto = require('crypto');
const mongoose = require('mongoose');

// Unambiguous characters for human-typed check-in codes
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
    // pending_payment: paid-event RSVP waiting for the ticket payment
    enum: ['going', 'maybe', 'not_going', 'cancelled', 'pending_payment'],
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
rsvpSchema.index({ event: 1, checkInCode: 1 });

// Recalculate event attendance: rsvpCount is confirmed RSVPs,
// currentAttendees is the headcount including each RSVP's guests
rsvpSchema.statics.syncEventCounts = async function(eventId) {
  const Event = mongoose.model('Event');

  const [totals] = await this.aggregate([
    { $match: { event: eventId, status: 'going' } },
    {
      $group: {
        _id: null,
        rsvps: { $sum: 1 },
        headcount: { $sum: { $add: [1, { $ifNull: ['$guestsCount', 0] }] } }
      }
    }
  ]);

  await Event.findByIdAndUpdate(eventId, {
    currentAttendees: totals ? totals.headcount : 0,
    rsvpCount: totals ? totals.rsvps : 0
  });
};

// Update event attendee count
rsvpSchema.post('save', async function() {
  await this.constructor.syncEventCounts(this.event);
});

// Also update on deletion
rsvpSchema.post('deleteOne', { document: true, query: false }, async function() {
  await this.constructor.syncEventCounts(this.event);
});

// Generate a random check-in code before saving
rsvpSchema.pre('save', function(next) {
  if (this.isNew && !this.checkInCode) {
    const bytes = crypto.randomBytes(8);
    this.checkInCode = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
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
