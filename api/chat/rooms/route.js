import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Room from '@/lib/models/Room';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function GET(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);

    // Get rooms where user is a participant OR an admin
    const userRooms = await Room.find({
      $and: [
        { isActive: true },
        { $or: [ { participants: decoded.userId }, { admins: decoded.userId } ] }
      ]
    })
    .populate('participants', 'username')
    .populate('createdBy', 'username')
    .populate('admins', 'username')
    .sort({ lastActivity: -1 });

    // console.log('GET /api/chat/rooms - Found rooms for user:', decoded.userId);
    userRooms.forEach(room => {
      // console.log('Room:', room.name, 'ID:', room._id, 'Admins:', room.admins);
    });

    return NextResponse.json(userRooms);
  } catch (err) {
    console.error('Error getting user rooms:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to get user rooms' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);
    const { name, description, participantIds } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }

    // Validate participants exist
    const participants = [decoded.userId]; // Creator is always a participant
    if (participantIds && participantIds.length > 0) {
      const validUsers = await User.find({ _id: { $in: participantIds } });
      if (validUsers.length !== participantIds.length) {
        return NextResponse.json({ error: 'Some participants not found' }, { status: 400 });
      }
      participants.push(...participantIds);
    }

    // Remove duplicates
    const uniqueParticipants = [...new Set(participants)];

    const newRoom = new Room({
      name,
      description: description || '',
      participants: uniqueParticipants,
      createdBy: decoded.userId,
      admins: [decoded.userId], // Creator is admin by default
      roomType: 'group'
    });

    await newRoom.save();

    const populatedRoom = await Room.findById(newRoom._id)
      .populate('participants', 'username')
      .populate('createdBy', 'username')
      .populate('admins', 'username');

    // Emit socket event to participants so clients update automatically
    try {
      const io = global.__io;
      if (io) {
        // Notify each participant's socket if they're connected
        populatedRoom.participants.forEach(p => {
          // try to find a socket for this user
          const sockets = Array.from(io.of('/').sockets.values());
          sockets.forEach(s => {
            if (s.user && (s.user.userId === p._id.toString() || s.user.userId === p._id)) {
              io.to(s.id).emit('roomCreated', populatedRoom);
            }
          });
        });
        console.log('Emitted roomCreated to participants');
      }
    } catch (emitErr) {
      console.warn('Failed to emit roomCreated event:', emitErr);
    }

    return NextResponse.json(populatedRoom, { status: 201 });
  } catch (err) {
    console.error('Error creating room:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}