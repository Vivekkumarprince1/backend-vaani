const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('../lib/db');
const User = require('../lib/models/User');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    await connectDB();

    const { mobileNumber, password } = req.body;

    const user = await User.findOne({ mobileNumber });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    // Update user status to online
    user.status = 'online';
    user.lastActive = Date.now();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        status: user.status,
        preferredLanguage: user.preferredLanguage
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/register', async (req, res) => {
  try {
    await connectDB();

    const { username, mobileNumber, password } = req.body;

    // Check if mobile number already exists
    const existingMobile = await User.findOne({ mobileNumber });
    if (existingMobile) {
      return res.status(400).json({ error: 'Mobile number already registered' });
    }

    // Check if username already exists
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const user = new User({
      username,
      mobileNumber,
      password: hashedPassword,
      email: undefined
    });

    await user.save();
    return res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    await connectDB();

    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ error: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update online status
    user.status = 'online';
    user.lastActive = Date.now();
    await user.save();

    return res.json(user);
  } catch (err) {
    console.error('Auth me error:', err);
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token is not valid' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    await connectDB();

    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ error: 'No token, authorization denied' });
    }

    jwt.verify(token, process.env.JWT_SECRET);

    const users = await User.find().select('-password');
    return res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token is not valid' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/language', authenticate, async (req, res) => {
  try {
    await connectDB();

    const { language } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { preferredLanguage: language },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch (err) {
    console.error('Update language error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;