import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import GroupCall from '@/lib/models/GroupCall';
import { authenticate } from '@/lib/auth';

/**
 * POST /api/chat/group-call/[callId]/leave
 * Leave a group call
 */
export async function POST(req, { params }) {
  try {
    const decoded = authenticate(req);
    const userId = decoded.userId || decoded.user?.id;

    await dbConnect();

    const resolvedParams = await params;
    const { callId } = resolvedParams;

    let groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return NextResponse.json(
        { message: 'Group call not found' },
        { status: 404 }
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
          return NextResponse.json(
            { message: 'Group call not found' },
            { status: 404 }
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

    return NextResponse.json({
      message: 'Left group call',
      callEnded: groupCall.status === 'ended'
    }, { status: 200 });

  } catch (error) {
    console.error('Error leaving group call:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
