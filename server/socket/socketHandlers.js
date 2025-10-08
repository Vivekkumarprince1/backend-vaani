const handleAudioTranslation = require('./audioHandler');
const handleGroupCallAudioTranslation = require('./groupCallAudioHandler');

module.exports = (io, users, rooms, findUserByUserId) => {
  // Handle socket connections
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    const userId = socket.userId;
    const username = socket.user.username || socket.user.user?.username || 'Unknown';

    // Clean up any existing connections for this userId (handle multiple devices/tabs)
    Object.keys(users).forEach(sid => {
      if (users[sid].userId === userId && sid !== socket.id) {
        console.log(`🧹 Cleaning up old connection for userId=${userId}, oldSocketId=${sid}`);
        delete users[sid];
      }
    });

    // Store user connection - KEY BY SOCKET ID for proper lookup in audio handler
    users[socket.id] = {
      socketId: socket.id,
      userId: userId,
      username: username,
      status: 'online',
      lastActive: new Date(),
      preferredLanguage: 'en' // Default, will be updated by updateLanguagePreference event
    };

    console.log(`✅ User registered: socketId=${socket.id}, userId=${userId}, username=${username}`);

    // Broadcast user online status
    socket.broadcast.emit('userStatusChange', {
      userId,
      status: 'online'
    });

    // Initialize audio translation handlers
    handleAudioTranslation(io, socket, users);
    handleGroupCallAudioTranslation(io, socket, users);

    // Handle language preference updates
    socket.on('updateLanguagePreference', (data) => {
      const { language } = data;
      if (language && users[socket.id]) {
        users[socket.id].preferredLanguage = language;
        socket.emit('languagePreferenceUpdated', {
          language,
          success: true
        });
      }
    });

    // Handle user joining a room
    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`User ${userId} joined room ${roomId}`);

      if (!rooms[roomId]) {
        rooms[roomId] = new Set();
      }
      rooms[roomId].add(userId);

      socket.to(roomId).emit('userJoinedRoom', {
        userId,
        username: socket.user.username,
        roomId
      });
    });

    // Handle leaving a room
    socket.on('leaveRoom', (roomId) => {
      socket.leave(roomId);
      console.log(`User ${userId} left room ${roomId}`);

      if (rooms[roomId]) {
        rooms[roomId].delete(userId);
        if (rooms[roomId].size === 0) {
          delete rooms[roomId];
        }
      }

      socket.to(roomId).emit('userLeftRoom', {
        userId,
        username: socket.user.username,
        roomId
      });
    });

    // Handle private messages
    socket.on('sendMessage', async (data) => {
      const { receiverId, content, roomId } = data;

      const message = {
        senderId: userId,
        senderName: socket.user.username,
        content,
        timestamp: new Date(),
        roomId
      };

      if (receiverId) {
        // Private message
        const receiverUser = findUserByUserId(receiverId);
        if (receiverUser) {
          io.to(receiverUser.socketId).emit('receiveMessage', message);
        }
      } else if (roomId) {
        // Room message
        socket.to(roomId).emit('receiveMessage', message);
      }

      // Send confirmation back to sender
      socket.emit('messageSent', { success: true, message });
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { receiverId, roomId, isTyping } = data;

      if (receiverId) {
        const receiverUser = findUserByUserId(receiverId);
        if (receiverUser) {
          io.to(receiverUser.socketId).emit('userTyping', {
            userId,
            username: socket.user.username,
            isTyping
          });
        }
      } else if (roomId) {
        socket.to(roomId).emit('userTyping', {
          userId,
          username: socket.user.username,
          isTyping
        });
      }
    });

    // WebRTC signaling events
    socket.on('callUser', (data) => {
      const { to, offer, callType, roomId } = data;
      console.log(`📞 Call initiated: from=${userId} to=${to}, callType=${callType}, roomId=${roomId}`);

      if (roomId) {
        // Group call - notify all room members except sender
        (async () => {
          try {
            const socketsInRoom = await io.in(roomId).fetchSockets();
            console.log(`📤 Emitting incomingCall to ${socketsInRoom.length - 1} peers in room ${roomId}`);
            for (const s of socketsInRoom) {
              if (s.id === socket.id) continue;
              io.to(s.id).emit('incomingCall', {
                from: userId,
                fromName: socket.user.username,
                offer,
                callType,
                roomId
              });
            }
          } catch (err) {
            console.error('Error emitting incomingCall to room:', err);
          }
        })();
      } else {
        // Private call
        const toUser = findUserByUserId(to);

        if (toUser) {
          const targetSocket = io.sockets.sockets.get(toUser.socketId);
          if (targetSocket) {
            io.to(toUser.socketId).emit('incomingCall', {
              from: userId,
              fromName: socket.user.username,
              offer,
              callType
            });
            socket.emit('incomingCallDelivered', { to, socketId: toUser.socketId });
          } else {
            delete users[toUser.socketId];
            socket.emit('userUnavailable', { to });
          }
        }
      }
    });

    socket.on('answerCall', (data) => {
      const { to, answer, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('callAnswered', {
          from: userId,
          answer,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('callAnswered', {
            from: userId,
            answer
          });
        }
      }
    });

    socket.on('iceCandidate', (data) => {
      const { to, candidate, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('iceCandidate', {
          from: userId,
          candidate,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('iceCandidate', {
            from: userId,
            candidate
          });
        }
      }
    });

    socket.on('endCall', (data) => {
      const { to, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('callEnded', {
          from: userId,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('callEnded', {
            from: userId
          });
        }
      }
    });

    // Group call events
    socket.on('joinGroupCall', (data) => {
      const { callRoomId, userId: joinUserId } = data;
      console.log(`👥 User ${joinUserId || userId} joining group call room: ${callRoomId}`);

      socket.join(callRoomId);

      socket.to(callRoomId).emit('userJoinedGroupCall', {
        userId: joinUserId || userId,
        username: socket.user.username,
        socketId: socket.id
      });

      io.in(callRoomId).allSockets().then(sockets => {
        const participants = Array.from(sockets)
          .filter(sid => sid !== socket.id)
          .map(sid => ({
            socketId: sid,
            userId: users[sid]?.userId,
            username: users[sid]?.username
          }))
          .filter(p => p.userId);

        socket.emit('existingParticipants', {
          callRoomId,
          participants
        });
      });
    });

    socket.on('leaveGroupCall', (data) => {
      const { callRoomId } = data;
      console.log(`👥 User ${userId} leaving group call room: ${callRoomId}`);

      socket.leave(callRoomId);

      socket.to(callRoomId).emit('userLeftGroupCall', {
        userId,
        username: socket.user.username,
        socketId: socket.id
      });
    });

    socket.on('groupCallOffer', (data) => {
      const { callRoomId, targetSocketId, offer } = data;
      io.to(targetSocketId).emit('groupCallOffer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        offer,
        callRoomId
      });
    });

    socket.on('groupCallAnswer', (data) => {
      const { callRoomId, targetSocketId, answer } = data;
      io.to(targetSocketId).emit('groupCallAnswer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        answer,
        callRoomId
      });
    });

    socket.on('groupCallIceCandidate', (data) => {
      const { callRoomId, targetSocketId, candidate } = data;
      io.to(targetSocketId).emit('groupCallIceCandidate', {
        fromSocketId: socket.id,
        fromUserId: userId,
        candidate,
        callRoomId
      });
    });

    socket.on('groupCallSpeaking', (data) => {
      const { callRoomId, isSpeaking } = data;
      socket.to(callRoomId).emit('participantSpeaking', {
        userId,
        username: socket.user.username,
        isSpeaking
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      const user = users[socket.id];
      if (user) {
        const userId = user.userId;
        user.status = 'offline';
        user.lastActive = new Date();

        socket.broadcast.emit('userStatusChange', {
          userId,
          status: 'offline'
        });

        setTimeout(() => {
          if (users[socket.id]?.status === 'offline') {
            delete users[socket.id];
          }
        }, 5 * 60 * 1000);

        Object.keys(rooms).forEach(roomId => {
          if (rooms[roomId]?.has(userId)) {
            rooms[roomId].delete(userId);
            if (rooms[roomId].size === 0) {
              delete rooms[roomId];
            }
          }
        });
      }
    });
  });
};