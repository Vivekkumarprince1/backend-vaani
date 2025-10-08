import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Chat from '@/lib/models/Chat';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function GET(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const roomId = searchParams.get('roomId');

    let query = {};

    if (roomId) {
      query = { room: roomId };
    } else if (userId) {
      query = {
        $or: [
          { sender: decoded.userId, receiver: userId },
          { sender: userId, receiver: decoded.userId }
        ],
        room: { $exists: false }
      };
    } else {
      return NextResponse.json({ error: 'Either userId or roomId is required' }, { status: 400 });
    }

    const messages = await Chat.find(query)
      .sort({ timestamp: 1 })
      .populate('sender', 'username preferredLanguage')
      .populate('receiver', 'username preferredLanguage');

    return NextResponse.json(messages);
  } catch (err) {
    console.error('Error getting chat history:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to get chat history' }, { status: 500 });
  }
}