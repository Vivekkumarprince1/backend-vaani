import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import { authenticate } from '@/lib/auth';

/**
 * POST /api/chat/group-call/[callId]/decline
 * Decline a group call invitation
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

    // Find participant and update status
    const participant = groupCall.participants.find(
      p => p.userId.toString() === userId.toString()
    );

    if (!participant) {
      return NextResponse.json(
        { message: 'You are not a participant of this call' },
        { status: 403 }
      );
    }

    participant.status = 'declined';

    await groupCall.save();

    return NextResponse.json({
      message: 'Group call declined'
    }, { status: 200 });

  } catch (error) {
    console.error('Error declining group call:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
