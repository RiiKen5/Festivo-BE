const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  // References
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Task Details
  taskName: {
    type: String,
    required: [true, 'Task name is required'],
    trim: true,
    maxlength: [200, 'Task name cannot exceed 200 characters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: String,
    enum: ['venue', 'food', 'decor', 'music', 'photo', 'logistics', 'communication', 'other'],
    required: true
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'done', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  // Dates
  dueDate: Date,
  completedAt: Date,

  // Budget
  budgetAllocated: {
    type: Number,
    min: 0
  },
  budgetSpent: {
    type: Number,
    default: 0,
    min: 0
  },

  // Related Booking
  linkedBooking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },

  // Attachments
  attachments: [String]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
taskSchema.index({ event: 1, status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ priority: 1 });
taskSchema.index({ createdAt: -1 });

// Auto-set completedAt when status changes to done
taskSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    if (this.status === 'done' && !this.completedAt) {
      this.completedAt = new Date();
    } else if (this.status !== 'done') {
      this.completedAt = undefined;
    }
  }
  next();
});

// Virtual for isOverdue
taskSchema.virtual('isOverdue').get(function() {
  if (this.status === 'done' || this.status === 'cancelled' || !this.dueDate) {
    return false;
  }
  return new Date() > this.dueDate;
});

// Static method to get tasks by priority
taskSchema.statics.getByPriority = function(eventId, priority) {
  return this.find({ event: eventId, priority, status: { $ne: 'cancelled' } })
    .sort({ dueDate: 1 })
    .populate('assignedTo', 'name profilePhoto');
};

// Static method to get overdue tasks
taskSchema.statics.getOverdueTasks = function(eventId) {
  return this.find({
    event: eventId,
    status: { $in: ['pending', 'in_progress'] },
    dueDate: { $lt: new Date() }
  })
    .sort({ dueDate: 1 })
    .populate('assignedTo', 'name profilePhoto');
};

module.exports = mongoose.model('Task', taskSchema);
