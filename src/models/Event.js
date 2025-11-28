const mongoose = require('mongoose');
const slugify = require('slugify');

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  eventType: {
    type: String,
    enum: ['birthday', 'house_party', 'meetup', 'wedding', 'corporate', 'farewell', 'other'],
    required: true
  },

  // Organizer
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coOrganizers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // Date & Time
  date: {
    type: Date,
    required: [true, 'Event date is required']
  },
  time: {
    type: String,
    required: true
  },
  endDate: Date,
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  },

  // Location
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  locationName: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },

  // Capacity
  expectedGuests: {
    type: Number,
    required: true,
    min: 1
  },
  maxAttendees: Number,
  currentAttendees: {
    type: Number,
    default: 0
  },

  // Budget
  budget: {
    type: Number,
    min: 0
  },
  budgetSpent: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },

  // Visibility
  isPublic: {
    type: Boolean,
    default: false
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['draft', 'planning', 'active', 'completed', 'cancelled'],
    default: 'draft'
  },

  // Entry
  entryFee: {
    type: Number,
    default: 0,
    min: 0
  },
  isPaid: {
    type: Boolean,
    default: false
  },

  // Media
  coverPhoto: String,
  photos: [String],

  // Categorization
  tags: [String],
  category: String,

  // Vibe (Phase 2)
  vibeScore: {
    type: String,
    enum: ['chill', 'party', 'networking', 'formal']
  },

  // Stats
  views: {
    type: Number,
    default: 0
  },
  rsvpCount: {
    type: Number,
    default: 0
  },
  overallRating: Number,
  totalReviews: {
    type: Number,
    default: 0
  },

  // Template
  isTemplate: {
    type: Boolean,
    default: false
  },
  templateSource: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  },
  timesUsedAsTemplate: {
    type: Number,
    default: 0
  },

  // SEO
  metaTitle: String,
  metaDescription: String,

  publishedAt: Date,
  completedAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes (slug already indexed via unique: true in schema)
eventSchema.index({ organizer: 1 });
eventSchema.index({ date: 1 });
eventSchema.index({ isPublic: 1, status: 1 });
eventSchema.index({ city: 1 });
eventSchema.index({ location: '2dsphere' });
eventSchema.index({ tags: 1 });
eventSchema.index({ eventType: 1 });
eventSchema.index({ title: 'text', description: 'text' });

// Generate slug before saving
eventSchema.pre('save', function(next) {
  if (this.isModified('title')) {
    const baseSlug = slugify(this.title, { lower: true, strict: true });
    this.slug = `${baseSlug}-${this.city.toLowerCase()}-${Date.now()}`;
  }
  next();
});

// Auto-update status if date is set
eventSchema.pre('save', function(next) {
  if (this.isModified('date') && this.status === 'draft') {
    this.status = 'planning';
  }
  next();
});

// Virtual for days until event
eventSchema.virtual('daysUntilEvent').get(function() {
  const now = new Date();
  const eventDate = new Date(this.date);
  const diff = eventDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Virtual populate tasks
eventSchema.virtual('tasks', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'event'
});

// Virtual populate RSVPs
eventSchema.virtual('rsvps', {
  ref: 'RSVP',
  localField: '_id',
  foreignField: 'event'
});

// Virtual populate bookings
eventSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'event'
});

module.exports = mongoose.model('Event', eventSchema);
