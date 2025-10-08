const connectDB = require('../lib/db');
const Room = require('../lib/models/Room');
const User = require('../lib/models/User');

class RoomController {
  /**
   * Get rooms for the current user
   */
  static async getRooms(req, res) {
    try {
      await connectDB();

      const userId = req.user.userId;

      // Get rooms where user is a participant OR an admin
      const userRooms = await Room.find({
        $and: [
          { isActive: true },
          { $or: [ { participants: userId }, { admins: userId } ] }
        ]
      })
      .populate('participants', 'username')
      .populate('createdBy', 'username')
      .populate('admins', 'username')
      .sort({ lastActivity: -1 });

      return res.json(userRooms);
    } catch (err) {
      console.error('Error getting user rooms:', err);
      if (err.message.includes('authorization')) {
        return res.status(401).json({ msg: err.message });
      }
      return res.status(500).json({ error: 'Failed to get user rooms' });
    }
  }

  /**
   * Create a new room
   */
  static async createRoom(req, res) {
    try {
      await connectDB();

      const userId = req.user.userId;
      const { name, description, participantIds } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Group name is required' });
      }

      // Validate participants exist
      const participants = [userId]; // Creator is always a participant
      if (participantIds && participantIds.length > 0) {
        const validUsers = await User.find({ _id: { $in: participantIds } });
        if (validUsers.length !== participantIds.length) {
          return res.status(400).json({ error: 'Some participants not found' });
        }
        participants.push(...participantIds);
      }

      // Remove duplicates
      const uniqueParticipants = [...new Set(participants)];

      const newRoom = new Room({
        name,
        description: description || '',
        participants: uniqueParticipants,
        createdBy: userId,
        admins: [userId], // Creator is admin by default
        roomType: 'group'
      });

      await newRoom.save();

      const populatedRoom = await Room.findById(newRoom._id)
        .populate('participants', 'username')
        .populate('createdBy', 'username')
        .populate('admins', 'username');

      // Emit socket event to participants so clients update automatically
      try {
        const io = global.__io;
        if (io) {
          // Notify each participant's socket if they're connected
          populatedRoom.participants.forEach(p => {
            // try to find a socket for this user
            const sockets = Array.from(io.of('/').sockets.values());
            sockets.forEach(s => {
              if (s.user && (s.user.userId === p._id.toString() || s.user.userId === p._id)) {
                io.to(s.id).emit('roomCreated', populatedRoom);
              }
            });
          });
          console.log('Emitted roomCreated to participants');
        }
      } catch (emitErr) {
        console.warn('Failed to emit roomCreated event:', emitErr);
      }

      return res.status(201).json(populatedRoom);
    } catch (err) {
      console.error('Error creating room:', err);
      if (err.message.includes('authorization')) {
        return res.status(401).json({ msg: err.message });
      }
      return res.status(500).json({ error: 'Failed to create room' });
    }
  }
}

module.exports = RoomController;