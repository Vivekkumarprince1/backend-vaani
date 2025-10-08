import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import { authenticate } from '@/lib/auth';

/**
 * GET /api/chat/group-call/pending
 * Get pending group call notifications for the current user
 */
export async function GET(req) {
  try {
    const decoded = authenticate(req);
    const userId = decoded.userId || decoded.user?.id;

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

    return NextResponse.json({
      calls: pendingCalls
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching pending group calls:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
