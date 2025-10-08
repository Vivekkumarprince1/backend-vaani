import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import { authenticate } from '@/lib/auth';

/**
 * GET /api/chat/group-call/[callId]
 * Get group call details
 */
export async function GET(req, { params }) {
  try {
    const decoded = authenticate(req);
    const userId = decoded.userId || decoded.user?.id;

    await dbConnect();

    const { callId } = params;

    const groupCall = await GroupCall.findById(callId)
      .populate('initiator', 'username email')
      .populate('participants.userId', 'username email')
      .populate('roomId', 'name participants');

    if (!groupCall) {
      return NextResponse.json(
        { message: 'Group call not found' },
        { status: 404 }
      );
    }

    // Check if user is a participant
    const isParticipant = groupCall.participants.some(
      p => p.userId._id.toString() === userId.toString()
    );

    if (!isParticipant) {
      return NextResponse.json(
        { message: 'You are not a participant of this call' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      call: groupCall
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching group call:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
