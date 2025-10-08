const connectDB = require('../lib/db');
const Chat = require('../lib/models/Chat');
const User = require('../lib/models/User');
const mongoose = require('mongoose');

class HistoryController {
  /**
   * Get chat history
   */
  static async getHistory(req, res) {
    try {
    await connectDB();

    const { userId, roomId } = req.query;
    let query = {};

    if (userId) {
      // Direct messages between current user and userId
      const targetUserId = new mongoose.Types.ObjectId(userId);
      const currentUserId = new mongoose.Types.ObjectId(req.user.userId);
      query = {
        $or: [
          { sender: currentUserId, receiver: targetUserId },
          { sender: targetUserId, receiver: currentUserId }
        ],
        room: { $exists: false }
      };
    } else if (roomId) {
      // Messages in the room
      query = { room: roomId };
    } else {
      return res.status(400).json({ error: 'userId or roomId required' });
    }

    const messages = await Chat.find(query)
      .populate('sender', 'username preferredLanguage')
      .populate('receiver', 'username preferredLanguage')
      .sort({ timestamp: 1 });

    return res.json({ messages, hasMore: false });
  } catch (err) {
    console.error('Get chat history error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
  }
}

module.exports = HistoryController;