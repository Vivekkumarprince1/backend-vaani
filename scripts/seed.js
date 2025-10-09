#!/usr/bin/env node
const connectDB = require('../lib/db');
const mongoose = require('mongoose');
const User = require('../lib/models/User');
const Room = require('../lib/models/Room');
const Chat = require('../lib/models/Chat');
const GroupCall = require('../lib/models/GroupCall');
const bcrypt = require('bcryptjs');

const { config: envConfig } = require('../server/utils/env');

async function seed() {
  // If no MONGO_URI is set in the environment, fall back to project's env config default
  if (!process.env.MONGO_URI && envConfig && envConfig.MONGO_URI) {
    process.env.MONGO_URI = envConfig.MONGO_URI;
  }
  try {
    await connectDB();

    console.log('Clearing existing data (users, rooms, chats, groupcalls)');
    await Promise.all([
      User.deleteMany({}),
      Room.deleteMany({}),
      Chat.deleteMany({}),
      GroupCall.deleteMany({})
    ]);

    console.log('Creating users');
    const pwd = await bcrypt.hash('pass123', 10);
    const users = await User.insertMany([
      { username: 'alice', mobileNumber: '1111111111', password: pwd, preferredLanguage: 'en', status: 'offline' },
      { username: 'bob', mobileNumber: '2222222222', password: pwd, preferredLanguage: 'es', status: 'offline' },
      { username: 'carol', mobileNumber: '3333333333', password: pwd, preferredLanguage: 'hi', status: 'offline' }
    ]);

    console.log('Creating rooms');
    const room1 = await Room.create({
      name: 'General',
      description: 'General discussion',
      participants: users.map(u => u._id),
      createdBy: users[0]._id,
      admins: [users[0]._id],
      roomType: 'group'
    });

    const room2 = await Room.create({
      name: 'Spanish Lovers',
      description: 'Para hablar en español',
      participants: [users[1]._id, users[0]._id],
      createdBy: users[1]._id,
      admins: [users[1]._id],
      roomType: 'group'
    });

    console.log('Seeding chats');
    await Chat.insertMany([
      { sender: users[0]._id, receiver: users[1]._id, originalContent: 'Hi Bob!', content: 'Hi Bob!', originalLanguage: 'en', timestamp: new Date() },
      { sender: users[1]._id, receiver: users[0]._id, originalContent: 'Hola Alice!', content: 'Hola Alice!', originalLanguage: 'es', timestamp: new Date() },
      { sender: users[2]._id, room: String(room1._id), isGroupMessage: true, originalContent: 'Hello everyone', content: 'Hello everyone', originalLanguage: 'hi', timestamp: new Date() }
    ]);

    console.log('Creating a pending group call');
    const groupCall = await GroupCall.create({
      roomId: room1._id,
      callRoomId: 'seed-call-1',
      initiator: users[0]._id,
      participants: users.map(u => ({ userId: u._id, status: 'invited' })),
      callType: 'audio',
      status: 'ringing'
    });

    console.log('Seed complete:');
    console.log('  users:', users.map(u => ({ id: u._id, username: u.username })));
    console.log('  rooms:', [room1.name, room2.name]);
    console.log('  groupCall:', groupCall.callRoomId);

    // Close mongoose connection
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err && err.message ? err.message : err);
    try { await mongoose.connection.close(); } catch (e) {}
    process.exit(1);
  }
}

seed();
