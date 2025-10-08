const dbConnect = require('../lib/db');
const GroupCall = require('../lib/models/GroupCall');
const Room = require('../lib/models/Room');
const { v4: uuidv4 } = require('uuid');

class GroupCallController {
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

      // Emit socket event to notify all participants (single event with participant IDs)
      try {
        if (global.__io) {
          const io = global.__io;
          // Emit to all participants
          room.participants.forEach(participantId => {
            const sockets = Array.from(io.of('/').sockets.values());
            sockets.forEach(socket => {
              if (socket.user && socket.user.userId === participantId.toString()) {
                io.to(socket.id).emit('groupCallInitiated', {
                  call: groupCall,
                  roomId: roomId
                });
              }
            });
          });
        }
      } catch (err) {
        console.error('Error emitting group call notification:', err);
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