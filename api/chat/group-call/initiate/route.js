import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import Room from '@/lib/models/Room';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * POST /api/chat/group-call/initiate
 * Initiate a group call for a room
 */
export async function POST(req) {
  try {
    const decoded = authenticate(req);
    const userId = decoded.userId || decoded.user?.id;

    await dbConnect();

    const body = await req.json();
    const { roomId, callType = 'video' } = body;

    if (!roomId) {
      return NextResponse.json(
        { message: 'Room ID is required' },
        { status: 400 }
      );
    }

    // Verify room exists and user is a participant
    const room = await Room.findById(roomId);
    if (!room) {
      return NextResponse.json(
        { message: 'Room not found' },
        { status: 404 }
      );
    }

    const isParticipant = room.participants.some(
      p => p.toString() === userId.toString()
    );
    if (!isParticipant) {
      return NextResponse.json(
        { message: 'You are not a participant of this room' },
        { status: 403 }
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
        
        return NextResponse.json(
          { 
            message: 'A call is already active for this room', 
            call: existingCall,
            alreadyActive: true
          },
          { status: 200 }
        );
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

        // Build participant id list (strings)
        const participantIds = participants.map(p => {
          try { return p.userId.toString(); } catch (e) { return String(p.userId || p); }
        });

        const initiatorUser = await User.findById(userId).select('username');

        const payload = {
          callId: groupCall._id,
          callRoomId,
          roomId,
          roomName: room.name,
          initiator: {
            id: userId,
            username: initiatorUser?.username || 'Unknown'
          },
          callType,
          participants: participantIds
        };

        // Broadcast as a fallback
        io.emit('groupCallIncoming', payload);

        // Also try delivering individually to connected participant sockets and mark delivered
        const sockets = Array.from(io.sockets.sockets.values());
        for (const participantUserId of participantIds) {
          if (String(participantUserId) === String(userId)) continue; // skip initiator
          const targetSocket = sockets.find(s => {
            try {
              return s.user && String(s.user.userId) === String(participantUserId);
            } catch (e) { return false; }
          });

          if (!targetSocket) continue;

          try {
            io.to(targetSocket.id).emit('groupCallIncoming', payload);

            // Mark participant delivery flags in DB
            const part = groupCall.participants.find(p => String(p.userId) === String(participantUserId));
            if (part) {
              part.notificationSent = true;
              part.notificationDelivered = true;
            }
          } catch (e) {
            console.warn('Failed to emit direct groupCallIncoming to socket', targetSocket.id, e.message || e);
          }
        }

        // Save any updated notification flags
        await groupCall.save();
      }
    } catch (err) {
      console.error('Error emitting group call notification:', err);
    }

    return NextResponse.json({
      message: 'Group call initiated',
      call: groupCall
    }, { status: 201 });

  } catch (error) {
    console.error('Error initiating group call:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
