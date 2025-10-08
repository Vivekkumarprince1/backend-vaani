import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function GET(request) {
  try {
    await connectDB();

    authenticate(request); // Just to check auth

    const users = await User.find()
      .select('-password')
      .sort({ status: -1, lastActive: -1 });

    // Update statuses based on last active
    const now = Date.now();
    const updatedUsers = users.map(user => {
      const isRecent = now - new Date(user.lastActive).getTime() < 300000; // 5 minutes
      return {
        ...user.toObject(),
        status: user.status === 'online' && isRecent ? 'online' : 'offline'
      };
    });

    return NextResponse.json(updatedUsers);
  } catch (err) {
    console.error('Error fetching users:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}