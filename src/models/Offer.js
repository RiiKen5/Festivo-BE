const mongoose = require('mongoose');

// A vendor offering one of their services for an event whose organizer asked
// for offers. Accepting it creates a confirmed booking at the offered price.
const offerSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  price: { type: Number, required: true, min: 0 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'withdrawn'],
    default: 'pending'
  },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  respondedAt: Date
}, {
  timestamps: true
});

offerSchema.index({ event: 1, status: 1 });
offerSchema.index({ vendor: 1, createdAt: -1 });
offerSchema.index({ event: 1, service: 1 });

module.exports = mongoose.model('Offer', offerSchema);
