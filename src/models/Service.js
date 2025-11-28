const mongoose = require('mongoose');
const slugify = require('slugify');

const serviceSchema = new mongoose.Schema({
  serviceName: {
    type: String,
    required: [true, 'Service name is required'],
    trim: true,
    maxlength: [200, 'Service name cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },

  // Provider
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Details
  category: {
    type: String,
    enum: ['food', 'decor', 'photography', 'music', 'cleanup', 'entertainment', 'venue', 'other'],
    required: true
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },

  // Pricing
  basePrice: {
    type: Number,
    required: [true, 'Base price is required'],
    min: 0
  },
  priceUnit: {
    type: String,
    enum: ['per_event', 'per_hour', 'per_day', 'per_person'],
    required: true
  },

  // Dynamic Pricing (Phase 2)
  surgeMultiplier: {
    type: Number,
    default: 1.0,
    min: 1.0
  },
  offPeakDiscount: {
    type: Number,
    default: 0,
    min: 0,
    max: 0.5
  },
  lastMinutePrice: Number,

  // Media
  portfolioImages: [String],
  portfolioVideos: [String],
  coverImage: String,

  // Location
  city: {
    type: String,
    required: true
  },
  serviceAreas: [String],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },

  // Availability
  availability: {
    type: String,
    enum: ['available', 'busy', 'not_taking_orders'],
    default: 'available'
  },
  availableDates: [Date],
  blackoutDates: [Date],

  // Stats
  ratingAverage: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  totalBookings: {
    type: Number,
    default: 0
  },
  completedBookings: {
    type: Number,
    default: 0
  },
  views: {
    type: Number,
    default: 0
  },

  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date,

  // Tags
  tags: [String],

  // Business Info
  businessName: String,
  gstNumber: String,
  panNumber: String,

  // SEO
  metaTitle: String,
  metaDescription: String,

  // Status
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes (slug already indexed via unique: true in schema)
serviceSchema.index({ provider: 1 });
serviceSchema.index({ category: 1 });
serviceSchema.index({ city: 1 });
serviceSchema.index({ availability: 1 });
serviceSchema.index({ ratingAverage: -1 });
serviceSchema.index({ basePrice: 1 });
serviceSchema.index({ location: '2dsphere' });
serviceSchema.index({ serviceName: 'text', description: 'text' });

// Generate slug
serviceSchema.pre('save', function(next) {
  if (this.isModified('serviceName')) {
    const baseSlug = slugify(this.serviceName, { lower: true, strict: true });
    this.slug = `${baseSlug}-${this.city.toLowerCase()}-${Date.now()}`;
  }
  next();
});

// Calculate completion rate
serviceSchema.virtual('completionRate').get(function() {
  if (this.totalBookings === 0) return 0;
  return ((this.completedBookings / this.totalBookings) * 100).toFixed(2);
});

// Virtual populate reviews
serviceSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'service'
});

// Virtual populate bookings
serviceSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'service'
});

module.exports = mongoose.model('Service', serviceSchema);
