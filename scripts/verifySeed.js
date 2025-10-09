#!/usr/bin/env node
const connectDB = require('../lib/db');
const mongoose = require('mongoose');
const User = require('../lib/models/User');
const Room = require('../lib/models/Room');
const Chat = require('../lib/models/Chat');
const GroupCall = require('../lib/models/GroupCall');
const { config: envConfig } = require('../server/utils/env');

(async () => {
  try {
    if (!process.env.MONGO_URI && envConfig && envConfig.MONGO_URI) {
      process.env.MONGO_URI = envConfig.MONGO_URI;
    }

    await connectDB();

    const usersCount = await User.countDocuments();
    const roomsCount = await Room.countDocuments();
    const chatsCount = await Chat.countDocuments();
    const groupCallsCount = await GroupCall.countDocuments();

    console.log('Counts:');
    console.log('  users:', usersCount);
    console.log('  rooms:', roomsCount);
    console.log('  chats:', chatsCount);
    console.log('  groupCalls:', groupCallsCount);

    const users = await User.find().limit(5).select('username mobileNumber preferredLanguage status').lean();
    console.log('Sample users:', users);

    const rooms = await Room.find().limit(5).lean();
    console.log('Sample rooms:', rooms.map(r => ({ id: r._id, name: r.name, participants: r.participants.length })));

    const gc = await GroupCall.find().limit(5).lean();
    console.log('Sample groupCalls:', gc.map(g => ({ callRoomId: g.callRoomId, status: g.status })));

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Verification error:', err && err.message ? err.message : err);
    try { await mongoose.connection.close(); } catch (e) {}
    process.exit(1);
  }
})();
