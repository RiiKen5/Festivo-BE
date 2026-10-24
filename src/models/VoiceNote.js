const mongoose = require('mongoose');

// Voice messages. Kept in the database and served only to the two people in
// the conversation, unlike public images.
const voiceNoteSchema = new mongoose.Schema({
  data: { type: Buffer, required: true },
  contentType: { type: String, required: true },
  size: Number,
  durationSec: { type: Number, min: 0, max: 300 },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('VoiceNote', voiceNoteSchema);
