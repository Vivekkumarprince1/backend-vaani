const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  roomType: {
    type: String,
    enum: ['group', 'private'],
    default: 'group'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for efficient queries
roomSchema.index({ participants: 1 });
roomSchema.index({ createdBy: 1 });
roomSchema.index({ lastActivity: -1 });
// Index admins for efficient queries when filtering by admin membership
roomSchema.index({ admins: 1 });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

module.exports = Room;