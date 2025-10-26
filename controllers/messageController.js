const connectDB = require('../lib/db');
const Chat = require('../lib/models/Chat');
const User = require('../lib/models/User');

class MessageController {
  /**
   * Send a message
   */
  static async sendMessage(req, res) {
    try {
      await connectDB();

      const decoded = req.user; // From authentication middleware
      const { receiverId, content, roomId, clientTempId } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Message content is required' });
      }

      const sender = await User.findById(decoded.userId);
      const originalLanguage = sender.preferredLanguage || 'en';

      const newMessage = new Chat({
        sender: decoded.userId,
        originalContent: content,
        content: content,
        originalLanguage,
        // mark as sent when saved to DB
        status: 'sent',
        timestamp: new Date(),
        translations: new Map()
      });

      if (roomId) {
        newMessage.room = roomId;
        newMessage.isGroupMessage = true;
      } else if (receiverId) {
        newMessage.receiver = receiverId;
      } else {
        return res.status(400).json({ error: 'Either receiverId or roomId is required' });
      }

      await newMessage.save();

      let populatedMessage = await Chat.findById(newMessage._id)
        .populate('sender', 'username preferredLanguage')
        .populate('receiver', 'username preferredLanguage');

      // Attach clientTempId to the emitted/returned object so clients can correlate optimistic sends
      try {
        populatedMessage = populatedMessage.toObject();
        if (clientTempId) populatedMessage.clientTempId = clientTempId;
      } catch (e) {
        // If toObject isn't available, set directly
        if (clientTempId) populatedMessage.clientTempId = clientTempId;
      }

      // Emit the saved/populated message to connected clients via Socket.IO
      try {
        const io = global.__io;
        if (io) {
          if (roomId) {
            // Emit to the room so all joined sockets receive the saved message
            io.to(roomId).emit('receiveMessage', populatedMessage);
          } else if (receiverId) {
            // Emit to the RECEIVER's connected sockets
            const sockets = Array.from(io.of('/').sockets.values());
            sockets.forEach(s => {
              if (s.user && (s.user.userId === receiverId || s.user.userId === receiverId.toString())) {
                console.log(`📨 [messageController] Sending receiveMessage to receiver: socket ${s.id}`);
                io.to(s.id).emit('receiveMessage', populatedMessage);
              }
            });
            
            // ALSO emit to SENDER so they can replace optimistic message with persisted one
            sockets.forEach(s => {
              if (s.user && (s.user.userId === decoded.userId || s.user.userId === decoded.userId.toString())) {
                console.log(`📨 [messageController] Sending receiveMessage to sender: socket ${s.id}`);
                io.to(s.id).emit('receiveMessage', populatedMessage);
              }
            });
          }
        }
      } catch (emitErr) {
        console.warn('Failed to emit saved message via Socket.IO:', emitErr);
      }

      // Inform sender sockets about the persisted status (sent)
      try {
        const io = global.__io;
        if (io) {
          const sockets = Array.from(io.of('/').sockets.values());
          const msgId = populatedMessage._id || populatedMessage.id;
          console.log(`✅ [messageController] Emitting messageStatusUpdate to sender (userId=${decoded.userId}): messageId=${msgId}, status=sent, clientTempId=${clientTempId}`);
          
          sockets.forEach(s => {
            if (s.user && (s.user.userId === decoded.userId || s.user.userId === decoded.userId.toString())) {
              console.log(`   📤 Sending to socket ${s.id}`);
              io.to(s.id).emit('messageStatusUpdate', {
                messageId: msgId,
                status: 'sent',
                clientTempId: clientTempId || null
              });
            }
          });
        }
      } catch (statusErr) {
        console.warn('Failed to emit messageStatusUpdate to sender sockets:', statusErr);
      }

      return res.status(201).json(populatedMessage);
    } catch (err) {
      console.error('Error saving message:', err);
      if (err.message.includes('authorization')) {
        return res.status(401).json({ msg: err.message });
      }
      return res.status(500).json({ error: 'Failed to save message' });
    }
  }
}

module.exports = MessageController;