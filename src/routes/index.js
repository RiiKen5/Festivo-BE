const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const eventRoutes = require('./eventRoutes');
const serviceRoutes = require('./serviceRoutes');
const bookingRoutes = require('./bookingRoutes');
const taskRoutes = require('./taskRoutes');
const rsvpRoutes = require('./rsvpRoutes');
const messageRoutes = require('./messageRoutes');
const reviewRoutes = require('./reviewRoutes');
const notificationRoutes = require('./notificationRoutes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/events', eventRoutes);
router.use('/services', serviceRoutes);
router.use('/bookings', bookingRoutes);
router.use('/tasks', taskRoutes);
router.use('/rsvps', rsvpRoutes);
router.use('/messages', messageRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);

// Health check
router.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  res.json({
    success: true,
    message: 'Festivo API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: {
      mongodb: mongoStatus[mongoState] || 'unknown',
      redis: process.env.REDIS_ENABLED === 'true' ? 'enabled' : 'disabled (mock)'
    },
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      events: '/api/v1/events',
      services: '/api/v1/services',
      bookings: '/api/v1/bookings',
      tasks: '/api/v1/tasks',
      rsvps: '/api/v1/rsvps',
      messages: '/api/v1/messages',
      reviews: '/api/v1/reviews',
      notifications: '/api/v1/notifications'
    }
  });
});

module.exports = router;
