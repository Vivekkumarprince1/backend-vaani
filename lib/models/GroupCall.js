const mongoose = require('mongoose');

const groupCallSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true
  },
  callRoomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['invited', 'joined', 'declined', 'left', 'missed'],
      default: 'invited'
    },
    joinedAt: Date,
    leftAt: Date,
    notificationSent: {
      type: Boolean,
      default: false
    },
    notificationDelivered: {
      type: Boolean,
      default: false
    }
  }],
  callType: {
    type: String,
    enum: ['audio', 'video'],
    default: 'video'
  },
  status: {
    type: String,
    enum: ['ringing', 'active', 'ended'],
    default: 'ringing',
    index: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  duration: Number, // in seconds
  activeParticipants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// Index for efficient queries
groupCallSchema.index({ roomId: 1, status: 1 });
groupCallSchema.index({ 'participants.userId': 1, status: 1 });
groupCallSchema.index({ callRoomId: 1, status: 1 });
groupCallSchema.index({ createdAt: -1 });

// Method to add participant
groupCallSchema.methods.addParticipant = function(userId, status = 'joined') {
  const existing = this.participants.find(p => p.userId.toString() === userId.toString());
  if (!existing) {
    this.participants.push({ 
      userId, 
      status,
      joinedAt: status === 'joined' ? new Date() : undefined
    });
  } else if (status === 'joined' && existing.status !== 'joined') {
    existing.status = 'joined';
    existing.joinedAt = new Date();
  }
  
  if (status === 'joined' && !this.activeParticipants.includes(userId)) {
    this.activeParticipants.push(userId);
  }
};

// Method to remove participant
groupCallSchema.methods.removeParticipant = function(userId) {
  const participant = this.participants.find(p => p.userId.toString() === userId.toString());
  if (participant) {
    participant.status = 'left';
    participant.leftAt = new Date();
  }
  
  this.activeParticipants = this.activeParticipants.filter(
    id => id.toString() !== userId.toString()
  );
};

// Method to end call
groupCallSchema.methods.endCall = function() {
  this.status = 'ended';
  this.endedAt = new Date();
  this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
  
  // Mark all non-joined participants as missed
  this.participants.forEach(p => {
    if (p.status === 'invited') {
      p.status = 'missed';
    } else if (p.status === 'joined' && !p.leftAt) {
      p.leftAt = this.endedAt;
    }
  });
};

const GroupCall = mongoose.models.GroupCall || mongoose.model('GroupCall', groupCallSchema);

module.exports = GroupCall;
