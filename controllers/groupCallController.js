const dbConnect = require('../lib/db');
const GroupCall = require('../lib/models/GroupCall');
const Room = require('../lib/models/Room');
const { v4: uuidv4 } = require('uuid');

class GroupCallController {
  // In-memory timers for calls with single participant
  // key: callId (string) -> timeoutId
  static _noParticipantTimers = global.__groupCallNoParticipantTimers || new Map();
  // Ensure global reference persists across modules
  static _ensureGlobalTimerMap() {
    if (!global.__groupCallNoParticipantTimers) global.__groupCallNoParticipantTimers = GroupCallController._noParticipantTimers;
    else GroupCallController._noParticipantTimers = global.__groupCallNoParticipantTimers;
  }
  /**
   * Get pending group call notifications for the current user
   */
  static async getPending(req, res) {
    try {
      const userId = req.user.userId;

      await dbConnect();

      // Find all ringing calls where user is a participant
      const pendingCalls = await GroupCall.find({
        'participants.userId': userId,
        'participants.status': 'invited',
        status: 'ringing'
      })
        .populate('initiator', 'username email')
        .populate('roomId', 'name participants')
        .sort({ createdAt: -1 });

      return res.status(200).json({
        calls: pendingCalls
      });
    } catch (error) {
      console.error('Error fetching pending group calls:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }

  /**
   * Initiate a group call for a room
   */
  static async initiate(req, res) {
    try {
      const userId = req.user.userId;

      await dbConnect();

      const { roomId, callType = 'video' } = req.body;

      if (!roomId) {
        return res.status(400).json(
          { message: 'Room ID is required' }
        );
      }

      // Verify room exists and user is a participant
      const room = await Room.findById(roomId);
      if (!room) {
        return res.status(404).json(
          { message: 'Room not found' }
        );
      }

      const isParticipant = room.participants.some(
        p => p.toString() === userId.toString()
      );
      if (!isParticipant) {
        return res.status(403).json(
          { message: 'You are not a participant of this room' }
        );
      }

      // Check if there's already an active call for this room
      let existingCall = await GroupCall.findOne({
        roomId,
        status: { $in: ['ringing', 'active'] }
      });

      if (existingCall) {
        // If the call has no active participants or is older than 5 minutes with status 'ringing',
        // it's likely abandoned - automatically end it and create a new one
        const callAge = Date.now() - new Date(existingCall.startedAt).getTime();
        const isAbandoned =
          existingCall.activeParticipants.length === 0 ||
          (existingCall.status === 'ringing' && callAge > 5 * 60 * 1000); // 5 minutes

        if (isAbandoned) {
          console.log(`🧹 Auto-ending abandoned call ${existingCall._id} for room ${roomId}`);
          console.log(`   - Active participants: ${existingCall.activeParticipants.length}`);
          console.log(`   - Status: ${existingCall.status}, Age: ${Math.floor(callAge / 1000)}s`);
          existingCall.endCall();
          await existingCall.save();
          // Clear the variable so we proceed to create a new call
          existingCall = null;
          console.log('✅ Abandoned call ended, proceeding to create new call');
        } else {
          // Return the existing active call with populated data
          console.log(`⚠️ Found active call ${existingCall._id} with ${existingCall.activeParticipants.length} participants`);
          await existingCall.populate('initiator', 'username email');
          await existingCall.populate('participants.userId', 'username email');
          await existingCall.populate('roomId', 'name participants');
          return res.status(200).json({
            message: 'Active call already exists for this room',
            call: existingCall
          });
        }
      }

      // Create unique call room ID
      const callRoomId = `group-call-${uuidv4()}`;

      // Create participants array (all room members)
      const participants = room.participants.map(participantId => ({
        userId: participantId,
        status: participantId.toString() === userId.toString() ? 'joined' : 'invited',
        joinedAt: participantId.toString() === userId.toString() ? new Date() : undefined,
        notificationSent: false,
        notificationDelivered: false
      }));

      // Create group call
      const groupCall = new GroupCall({
        roomId,
        callRoomId,
        initiator: userId,
        participants,
        callType,
        status: 'ringing',
        activeParticipants: [userId]
      });

      await groupCall.save();

      // Populate for response
      await groupCall.populate('initiator', 'username email');
      await groupCall.populate('participants.userId', 'username email');
      await groupCall.populate('roomId', 'name participants');

      // Emit socket event to notify all participants
      console.log(`📞 Notifying ${room.participants.length} participants about group call in room: ${room.name}`);
      
      try {
        if (global.__io) {
          const io = global.__io;
          let notificationsSent = 0;
          const notifiedParticipants = new Set();
          
              // Prepare payload matching frontend expectation (updated)
              const payload = {
                callId: groupCall._id,
                callRoomId: groupCall.callRoomId,
                roomId: groupCall.roomId._id,
                roomName: groupCall.roomId.name,
                callType: groupCall.callType,
                initiator: {
                  _id: groupCall.initiator._id,
                  username: groupCall.initiator.username,
                  email: groupCall.initiator.email
                },
                participants: groupCall.participants.map(p => ({
                  userId: p.userId._id,
                  status: p.status,
                  username: p.userId.username
                }))
              };
          
          // Fetch sockets in the chat room and notify each socket individually so we can exclude initiator
          const roomSocketName = roomId.toString();
          const socketsInRoom = await io.in(roomSocketName).fetchSockets();

          if (socketsInRoom.length > 0) {
            console.log(`   🎯 Found ${socketsInRoom.length} socket(s) in room ${roomSocketName}, sending individually (excluding initiator)`);
          } else {
            console.log(`   ℹ️ No sockets found in room ${roomSocketName}, will search all connected sockets`);
          }

          const allSockets = socketsInRoom.length > 0 ? socketsInRoom : Array.from(io.of('/').sockets.values());

          // For each participant, find their sockets and emit the standard 'group_incoming_call' event, skipping initiator
          room.participants.forEach(participantId => {
            const participantIdStr = participantId.toString();

            // Skip initiator
            if (participantIdStr === groupCall.initiator._id.toString()) {
              return;
            }

            const participantSockets = allSockets.filter(socket => socket.user && socket.user.userId === participantIdStr);

            if (participantSockets.length === 0) {
              // No connected socket for this participant
              return;
            }

            participantSockets.forEach(socket => {
              console.log(`      ✅ Emitting 'group_incoming_call' to socket ${socket.id} for participant ${participantIdStr}`);
              io.to(socket.id).emit('group_incoming_call', payload);
              notificationsSent++;
              notifiedParticipants.add(participantIdStr);
            });
          });
          
          console.log(`   📤 Sent ${notificationsSent} notifications to ${notifiedParticipants.size} unique participants`);
          
          // Update notification flags for all notified participants
          groupCall.participants.forEach(participant => {
            const participantIdStr = participant.userId._id.toString();
            if (notifiedParticipants.has(participantIdStr)) {
              participant.notificationSent = true;
            }
          });
          
          // Save updated notification flags
          if (notificationsSent > 0) {
            await groupCall.save();
          }
        } else {
          console.warn('   ⚠️ Socket.IO instance not available (global.__io is undefined)');
        }
      } catch (err) {
        console.error('❌ Error emitting group call notification:', err);
        console.error('Error details:', err.stack);
      }

      return res.status(201).json({
        message: 'Group call initiated',
        call: groupCall
      });
    } catch (error) {
      console.error('Error initiating group call:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }

  /**
   * Get group call details
   */
  static async getCall(req, res) {
    try {
      const userId = req.user.userId;
      const { callId } = req.params;

      await dbConnect();

      const groupCall = await GroupCall.findById(callId)
        .populate('initiator', 'username email')
        .populate('participants.userId', 'username email')
        .populate('roomId', 'name participants');

      if (!groupCall) {
        return res.status(404).json(
          { message: 'Group call not found' }
        );
      }

      // Check if user is a participant
      const isParticipant = groupCall.participants.some(
        p => p.userId._id.toString() === userId.toString()
      );

      if (!isParticipant) {
        return res.status(403).json(
          { message: 'You are not a participant of this call' }
        );
      }

      return res.status(200).json({
        call: groupCall
      });
    } catch (error) {
      console.error('Error fetching group call:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }

  /**
   * Decline a group call invitation
   */
  static async decline(req, res) {
    try {
      const userId = req.user.userId;
      const { callId } = req.params;

      await dbConnect();

      const groupCall = await GroupCall.findById(callId);
      if (!groupCall) {
        return res.status(404).json(
          { message: 'Group call not found' }
        );
      }

      // Find participant and update status
      const participant = groupCall.participants.find(
        p => p.userId.toString() === userId.toString()
      );

      if (!participant) {
        return res.status(403).json(
          { message: 'You are not a participant of this call' }
        );
      }

      participant.status = 'declined';

      await groupCall.save();

      return res.status(200).json({
        message: 'Group call declined'
      });
    } catch (error) {
      console.error('Error declining group call:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }

  /**
   * Join a group call
   */
  static async join(req, res) {
    try {
      const userId = req.user.userId;
      const { callId } = req.params;

      await dbConnect();

      const groupCall = await GroupCall.findById(callId);
      if (!groupCall) {
        return res.status(404).json(
          { message: 'Group call not found' }
        );
      }

      // Check if user is a participant
      const participant = groupCall.participants.find(
        p => p.userId.toString() === userId.toString()
      );

      if (!participant) {
        return res.status(403).json(
          { message: 'You are not a participant of this call' }
        );
      }

      // Update participant status
      participant.status = 'joined';
      participant.joinedAt = new Date();

      // Add to active participants if not already there
      if (!groupCall.activeParticipants.includes(userId)) {
        groupCall.activeParticipants.push(userId);
      }

      // If call is still ringing and first person joins, make it active
      if (groupCall.status === 'ringing' && groupCall.activeParticipants.length >= 2) {
        groupCall.status = 'active';
      }

      await groupCall.save();

      // Clear any pending "no participants" timer when someone joins
      try {
        GroupCallController._ensureGlobalTimerMap();
        const timers = GroupCallController._noParticipantTimers;
        const callIdStr = groupCall._id.toString();
        if (timers.has(callIdStr)) {
          clearTimeout(timers.get(callIdStr));
          timers.delete(callIdStr);
          console.log(`⏱️ Cleared no-participant timer for call ${callIdStr} because someone joined`);
        }
      } catch (e) {
        console.warn('Failed to clear no-participant timer on join:', e);
      }

      // Notify other participants
      try {
        if (global.__io) {
          const io = global.__io;
          io.to(groupCall.callRoomId).emit('participantJoined', {
            callId: groupCall._id,
            userId,
            activeParticipants: groupCall.activeParticipants
          });
        }
      } catch (err) {
        console.error('Error emitting participant joined event:', err);
      }

      await groupCall.populate('participants.userId', 'username email');
      await groupCall.populate('roomId', 'name');

      return res.status(200).json({
        message: 'Joined group call',
        call: groupCall
      });
    } catch (error) {
      console.error('Error joining group call:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }

  /**
   * Leave a group call
   */
  static async leave(req, res) {
    try {
      const userId = req.user.userId;
      const { callId } = req.params;

      await dbConnect();

      let groupCall = await GroupCall.findById(callId);
      if (!groupCall) {
        return res.status(404).json(
          { message: 'Group call not found' }
        );
      }

      // Remove participant with retry logic for version conflicts
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          // Use findOneAndUpdate to avoid version conflicts
          const updateResult = await GroupCall.findOneAndUpdate(
            { _id: callId },
            {
              $set: {
                'participants.$[elem].status': 'left',
                'participants.$[elem].leftAt': new Date()
              },
              $pull: {
                activeParticipants: userId
              }
            },
            {
              arrayFilters: [{ 'elem.userId': userId }],
              new: true
            }
          );

          if (!updateResult) {
            return res.status(404).json(
              { message: 'Group call not found' }
            );
          }

          groupCall = updateResult;
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.error('Failed to update group call after retries:', error);
            throw error;
          }
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        }
      }

      // If no active participants left, end the call
      if (groupCall.activeParticipants.length === 0) {
        groupCall.status = 'ended';
        groupCall.endedAt = new Date();
        groupCall.duration = Math.floor((groupCall.endedAt - groupCall.startedAt) / 1000);

        // Mark all non-joined participants as missed
        groupCall.participants.forEach(p => {
          if (p.status === 'invited') {
            p.status = 'missed';
          } else if (p.status === 'joined' && !p.leftAt) {
            p.leftAt = groupCall.endedAt;
          }
        });

        await groupCall.save();
      }

      // If only one active participant remains, start a 30s timer to auto-end the call
      try {
        GroupCallController._ensureGlobalTimerMap();
        const timers = GroupCallController._noParticipantTimers;
        const callIdStr = groupCall._id.toString();

        if (groupCall.activeParticipants.length === 1) {
          // Clear existing timer if any
          if (timers.has(callIdStr)) {
            clearTimeout(timers.get(callIdStr));
            timers.delete(callIdStr);
          }

          console.log(`⏱️ Starting no-participant timer for call ${callIdStr} (30s)`);
          const t = setTimeout(async () => {
            try {
              // Re-fetch latest state
              await dbConnect();
              const fresh = await GroupCall.findById(callId);
              if (!fresh) return;
              if (fresh.activeParticipants.length <= 1 && fresh.status !== 'ended') {
                // End the call
                fresh.status = 'ended';
                fresh.endedAt = new Date();
                fresh.duration = Math.floor((fresh.endedAt - fresh.startedAt) / 1000);
                fresh.participants.forEach(p => {
                  if (p.status === 'invited') p.status = 'missed';
                  else if (p.status === 'joined' && !p.leftAt) p.leftAt = fresh.endedAt;
                });
                await fresh.save();

                // Emit event to notify all sockets in call room
                if (global.__io) {
                  try {
                    const io = global.__io;
                    io.to(fresh.callRoomId).emit('group_call_ended', { callId: fresh._id, reason: 'no_participants' });
                    console.log(`📣 Emitted group_call_ended for call ${fresh._id} reason=no_participants`);
                  } catch (e) {
                    console.warn('Failed to emit group_call_ended:', e);
                  }
                }
              }
            } catch (e) {
              console.error('Error in no-participant timer handler:', e);
            } finally {
              // Clean up timer map
              try { timers.delete(callIdStr); } catch (e) {}
            }
          }, 30 * 1000);

          timers.set(callIdStr, t);
        } else {
          // If more than one participant, ensure no timer is running
          if (timers.has(callIdStr)) {
            clearTimeout(timers.get(callIdStr));
            timers.delete(callIdStr);
            console.log(`⏱️ Cleared no-participant timer for call ${callIdStr} because participants increased`);
          }
        }
      } catch (e) {
        console.warn('Failed to manage no-participant timer on leave:', e);
      }

      // Notify other participants
      try {
        if (global.__io) {
          const io = global.__io;
          io.to(groupCall.callRoomId).emit('participantLeft', {
            callId: groupCall._id,
            userId,
            activeParticipants: groupCall.activeParticipants,
            callEnded: groupCall.status === 'ended'
          });
        }
      } catch (err) {
        console.error('Error emitting participant left event:', err);
      }

      return res.status(200).json({
        message: 'Left group call',
        callEnded: groupCall.status === 'ended'
      });
    } catch (error) {
      console.error('Error leaving group call:', error);
      return res.status(500).json(
        { message: 'Internal server error', error: error.message }
      );
    }
  }
}

module.exports = GroupCallController;