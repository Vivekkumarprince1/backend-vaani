const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('../lib/db');
const Room = require('../lib/models/Room');
const GroupCall = require('../lib/models/GroupCall');
const Chat = require('../lib/models/Chat');

// Import controllers
const MessageController = require('../controllers/messageController');
const GroupCallController = require('../controllers/groupCallController');
const RoomController = require('../controllers/roomController');
const HistoryController = require('../controllers/historyController');
const TranslateController = require('../controllers/translateController');

const router = express.Router();

// Middleware to authenticate
const authenticate = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};

router.post('/message', authenticate, MessageController.sendMessage);

router.get('/rooms', authenticate, RoomController.getRooms);
router.post('/rooms', authenticate, RoomController.createRoom);

router.get('/group-call/pending', authenticate, GroupCallController.getPending);
router.post('/group-call/initiate', authenticate, GroupCallController.initiate);
router.get('/group-call/:callId', authenticate, GroupCallController.getCall);
router.post('/group-call/:callId/decline', authenticate, GroupCallController.decline);
router.post('/group-call/:callId/join', authenticate, GroupCallController.join);
router.post('/group-call/:callId/leave', authenticate, GroupCallController.leave);

router.get('/history', authenticate, HistoryController.getHistory);

router.post('/translate', authenticate, TranslateController.translate);

module.exports = router;