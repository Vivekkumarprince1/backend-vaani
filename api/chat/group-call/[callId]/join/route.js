import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import { authenticate } from '@/lib/auth';

/**
 * POST /api/chat/group-call/[callId]/join
 * Join a group call
 */
export async function POST(req, { params }) {
  try {
    const decoded = authenticate(req);
    const userId = decoded.userId || decoded.user?.id;

    await dbConnect();

    const resolvedParams = await params;
    const { callId } = resolvedParams;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return NextResponse.json(
        { message: 'Group call not found' },
        { status: 404 }
      );
    }

    // Check if user is a participant
    const participant = groupCall.participants.find(
      p => p.userId.toString() === userId.toString()
    );

    if (!participant) {
      return NextResponse.json(
        { message: 'You are not a participant of this call' },
        { status: 403 }
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

    return NextResponse.json({
      message: 'Joined group call',
      call: groupCall
    }, { status: 200 });

  } catch (error) {
    console.error('Error joining group call:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
