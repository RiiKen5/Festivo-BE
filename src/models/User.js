const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  profilePhoto: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },
  userType: {
    type: String,
    enum: ['organizer', 'helper', 'attendee', 'all'],
    default: 'all'
  },
  city: {
    type: String,
    required: [true, 'City is required']
  },
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
  interests: [{
    type: String
  }],

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
  eventsOrganized: {
    type: Number,
    default: 0
  },
  eventsAttended: {
    type: Number,
    default: 0
  },

  // Gamification
  xpPoints: {
    type: Number,
    default: 0
  },
  level: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum'],
    default: 'Bronze'
  },
  badges: [{
    type: String
  }],

  // Security
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  refreshTokens: [{
    type: String,
    select: false
  }],
  passwordResetToken: String,
  passwordResetExpires: Date,

  // Email Verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // Phone Verification (OTP)
  phoneOTP: {
    type: String,
    select: false
  },
  phoneOTPExpires: Date,

  // Preferences
  notifications: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    push: { type: Boolean, default: true }
  },

  // Social Links
  socialLinks: {
    instagram: String,
    facebook: String,
    linkedin: String
  },

  // Admin
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  lastLoginAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes (email and phone already indexed via unique: true)
userSchema.index({ city: 1 });
userSchema.index({ userType: 1 });
userSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT Access Token
userSchema.methods.generateAccessToken = function() {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      role: this.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );
};

// Generate JWT Refresh Token
userSchema.methods.generateRefreshToken = function() {
  return jwt.sign(
    { id: this._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

// Update level based on XP
userSchema.methods.updateLevel = function() {
  if (this.xpPoints >= 1501) this.level = 'Platinum';
  else if (this.xpPoints >= 501) this.level = 'Gold';
  else if (this.xpPoints >= 101) this.level = 'Silver';
  else this.level = 'Bronze';
};

// Don't return sensitive data
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
