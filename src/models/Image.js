const mongoose = require('mongoose');

// Uploaded images stored in the database. Used when S3 isn't configured, so
// uploads work on a plain deployment (Render's disk is wiped on deploy).
const imageSchema = new mongoose.Schema({
  data: {
    type: Buffer,
    required: true
  },
  contentType: {
    type: String,
    required: true
  },
  size: Number,
  width: Number,
  height: Number,
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

imageSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Image', imageSchema);
