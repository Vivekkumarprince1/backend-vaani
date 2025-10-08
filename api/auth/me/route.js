import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function GET(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update online status
    user.status = 'online';
    user.lastActive = Date.now();
    await user.save();

    return NextResponse.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}