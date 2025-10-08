
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const handleAudioTranslation = require('./server/socket/audioHandler');
const handleGroupCallAudioTranslation = require('./server/socket/groupCallAudioHandler');
const socketHandlers = require('./server/socket/socketHandlers');

// Validate Azure env and expose TTS availability
const { config: envConfig } = require('./server/utils/env');
const ttsAvailable = Boolean(envConfig.AZURE_SPEECH_KEY && envConfig.AZURE_SPEECH_REGION);
global.__TTS_AVAILABLE = ttsAvailable;

console.log('🔑 Azure Configuration:');
console.log('  AZURE_SPEECH_KEY:', envConfig.AZURE_SPEECH_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_SPEECH_REGION:', envConfig.AZURE_SPEECH_REGION ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_TRANSLATOR_KEY:', envConfig.AZURE_TRANSLATOR_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_TRANSLATOR_REGION:', envConfig.AZURE_TRANSLATOR_REGION ? '✅ Loaded' : '❌ Missing');
console.log('  JWT_SECRET:', envConfig.JWT_SECRET ? '✅ Loaded' : '❌ Missing');
console.log('  NODE_ENV:', envConfig.NODE_ENV || 'development');
console.log('  PORT:', envConfig.PORT || '3001');
console.log('  ALLOWED_ORIGINS:', envConfig.ALLOWED_ORIGINS || '❌ Missing');


if (!ttsAvailable) {
  console.warn('\n⚠️ Text-to-Speech is NOT available. Group-call TTS will be skipped and clients will receive text-only translations.');
  console.warn('   Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in your environment or .env to enable server TTS.\n');
} else {
  console.log('\n✅ Text-to-Speech is available and will be used for translated audio in group calls.');
}

const port = parseInt(process.env.PORT || '3001', 10); // Different port for backend

const app = express();
app.use(cors({
  origin: envConfig.ALLOWED_ORIGINS,
  credentials: true
}));
app.use(express.json());

// API Routes will be mounted here
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const translatorRoutes = require('./routes/translator');
app.use('/api/translator', translatorRoutes);

const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

const server = createServer(app);

// Store active users and their rooms
const users = {}; // Now keyed by socketId for proper audio translation lookup
const rooms = {};

// Helper function to find user by userId
const findUserByUserId = (userId) => {
  return Object.values(users).find(user => user.userId === userId);
};

// Initialize Socket.IO with OPTIMIZED settings for low latency
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: envConfig.ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
  },
  // ✅ OPTIMIZED: Allow both transports but prefer WebSocket
  transports: ['websocket', 'polling'],
  allowUpgrades: true, // Allow upgrade from polling to WebSocket
  upgradeTimeout: 10000,
  
  // ✅ OPTIMIZED: Reduce ping intervals for faster connection checks
  pingTimeout: 60000,
  pingInterval: 25000,
  
  // ✅ OPTIMIZED: Increase buffer for larger audio payloads
  maxHttpBufferSize: 1e7, // 10MB (was 5MB)
  
  // ✅ OPTIMIZED: Disable compression for speed (trade bandwidth for latency)
  perMessageDeflate: false, // Compression adds latency
  
  connectTimeout: 30000,
  serveClient: false
});

// Expose io globally so routes can emit events
global.__io = io;
console.log('Global Socket.IO instance set: global.__io');

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  
  if (!token) {
    console.error('No token provided for socket connection');
    return next(new Error('Authentication error: No token provided'));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.user = decoded;
    next();
  } catch (err) {
    console.error('Socket authentication failed:', err.message);
    next(new Error('Authentication error: Invalid token'));
  }
});

// Socket event handlers
socketHandlers(io, users, rooms, findUserByUserId);

// Cleanup stale connections every 5 minutes
setInterval(() => {
  console.log('Cleaning up stale connections');
  Object.keys(users).forEach(socketId => {
    const user = users[socketId];
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      console.log(`Removing stale user: socketId=${socketId}, userId=${user?.userId}`);
      delete users[socketId];
    }
  });
}, 5 * 60 * 1000);

server.listen(port, '0.0.0.0', () => {
  console.log(`Backend server running on port http://localhost:${port}`);
});
