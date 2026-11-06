const mongoose = require('mongoose');

// Small key/value store for background jobs that must remember things
// across restarts (the free Render plan sleeps and restarts often)
const siteStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

module.exports = mongoose.model('SiteState', siteStateSchema);
