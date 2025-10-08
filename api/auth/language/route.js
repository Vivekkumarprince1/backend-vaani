import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function PUT(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);
    const { language } = await request.json();

    if (!language) {
      return NextResponse.json({ error: 'Language is required' }, { status: 400 });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { preferredLanguage: language },
      { new: true }
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Language preference updated', language: user.preferredLanguage });
  } catch (err) {
    console.error('Error updating language preference:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}