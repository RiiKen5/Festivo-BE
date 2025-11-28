const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // References
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
    unique: true
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  },

  // Rating & Review
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: 1,
    max: 5
  },
  reviewText: {
    type: String,
    required: [true, 'Review text is required'],
    minlength: [10, 'Review must be at least 10 characters'],
    maxlength: [1000, 'Review cannot exceed 1000 characters']
  },

  // Detailed Ratings
  ratings: {
    quality: { type: Number, min: 1, max: 5 },
    punctuality: { type: Number, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    valueForMoney: { type: Number, min: 1, max: 5 }
  },

  // Media
  photos: [String],

  // Vendor Response
  vendorResponse: {
    type: String,
    maxlength: [500, 'Response cannot exceed 500 characters']
  },
  respondedAt: Date,

  // Moderation
  isApproved: {
    type: Boolean,
    default: true
  },
  isFlagged: {
    type: Boolean,
    default: false
  },
  flagReason: String,

  // Helpful Votes
  helpfulCount: {
    type: Number,
    default: 0
  },
  helpfulVoters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Indexes
reviewSchema.index({ service: 1, createdAt: -1 });
reviewSchema.index({ vendor: 1 });
reviewSchema.index({ reviewer: 1 });
reviewSchema.index({ rating: -1 });
reviewSchema.index({ isApproved: 1 });

// Update service rating after review
reviewSchema.post('save', async function() {
  if (this.isNew || this.isModified('rating')) {
    await this.constructor.updateServiceRating(this.service);
  }
});

reviewSchema.post('deleteOne', { document: true, query: false }, async function() {
  await this.constructor.updateServiceRating(this.service);
});

// Static method to update service rating
reviewSchema.statics.updateServiceRating = async function(serviceId) {
  const stats = await this.aggregate([
    { $match: { service: serviceId, isApproved: true } },
    {
      $group: {
        _id: '$service',
        avgRating: { $avg: '$rating' },
        totalRatings: { $sum: 1 }
      }
    }
  ]);

  const Service = mongoose.model('Service');

  if (stats.length > 0) {
    await Service.findByIdAndUpdate(serviceId, {
      ratingAverage: Math.round(stats[0].avgRating * 10) / 10,
      totalRatings: stats[0].totalRatings
    });
  } else {
    await Service.findByIdAndUpdate(serviceId, {
      ratingAverage: 0,
      totalRatings: 0
    });
  }

  // Also update vendor rating
  const service = await Service.findById(serviceId);
  if (service) {
    await this.updateVendorRating(service.provider);
  }
};

// Static method to update vendor rating
reviewSchema.statics.updateVendorRating = async function(vendorId) {
  const Service = mongoose.model('Service');

  const services = await Service.find({ provider: vendorId });
  const serviceIds = services.map(s => s._id);

  const stats = await this.aggregate([
    { $match: { service: { $in: serviceIds }, isApproved: true } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        totalRatings: { $sum: 1 }
      }
    }
  ]);

  const User = mongoose.model('User');

  if (stats.length > 0) {
    await User.findByIdAndUpdate(vendorId, {
      ratingAverage: Math.round(stats[0].avgRating * 10) / 10,
      totalRatings: stats[0].totalRatings
    });
  }
};

// Method to add helpful vote
reviewSchema.methods.addHelpfulVote = async function(userId) {
  if (!this.helpfulVoters.includes(userId)) {
    this.helpfulVoters.push(userId);
    this.helpfulCount += 1;
    await this.save();
    return true;
  }
  return false;
};

// Method to remove helpful vote
reviewSchema.methods.removeHelpfulVote = async function(userId) {
  const index = this.helpfulVoters.indexOf(userId);
  if (index > -1) {
    this.helpfulVoters.splice(index, 1);
    this.helpfulCount -= 1;
    await this.save();
    return true;
  }
  return false;
};

module.exports = mongoose.model('Review', reviewSchema);
