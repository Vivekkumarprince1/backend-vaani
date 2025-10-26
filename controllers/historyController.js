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

  /**
   * Get unread message counts per contact and room
   */
  static async getUnreadCounts(req, res) {
    try {
      await connectDB();

      const currentUserId = new mongoose.Types.ObjectId(req.user.userId);

      // Get unread counts for direct messages (private chats)
      // Messages where current user is the receiver and status is not 'seen'
      const directMessageCounts = await Chat.aggregate([
        {
          $match: {
            receiver: currentUserId,
            status: { $in: ['sent', 'delivered'] }, // Not seen yet
            room: { $exists: false }
          }
        },
        {
          $group: {
            _id: '$sender',
            unreadCount: { $sum: 1 }
          }
        }
      ]);

      // Get unread counts for room messages (group chats)
      // Messages in rooms where current user is not the sender and status is not 'seen'
      const roomMessageCounts = await Chat.aggregate([
        {
          $match: {
            room: { $exists: true },
            sender: { $ne: currentUserId },
            status: { $in: ['sent', 'delivered'] } // Not seen yet
          }
        },
        {
          $group: {
            _id: '$room',
            unreadCount: { $sum: 1 }
          }
        }
      ]);

      // Format the results
      const unreadByContact = {};
      directMessageCounts.forEach(item => {
        unreadByContact[item._id.toString()] = item.unreadCount;
      });

      const unreadByRoom = {};
      roomMessageCounts.forEach(item => {
        unreadByRoom[item._id] = item.unreadCount;
      });

      return res.json({
        unreadByContact,
        unreadByRoom
      });
    } catch (err) {
      console.error('Get unread counts error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

module.exports = HistoryController;