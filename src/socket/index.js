const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { corsOrigin } = require('../config/frontend');

let io = null;

// Open connections per user id (a user may have several tabs)
const online = new Map();
const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('name profilePhoto');

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();

    // Personal room: messages, read receipts and notifications for this user
    socket.join(userId);
    const wasOnline = online.has(userId);
    online.set(userId, (online.get(userId) || 0) + 1);
    if (!wasOnline) socket.broadcast.emit('user_status_change', { userId, status: 'online' });

    socket.on('join_event', (eventId) => {
      if (isId(eventId)) socket.join(`event:${eventId}`);
    });

    socket.on('leave_event', (eventId) => {
      if (isId(eventId)) socket.leave(`event:${eventId}`);
    });

    // Whether these users have the app open right now
    socket.on('presence', (userIds, reply) => {
      if (!Array.isArray(userIds) || typeof reply !== 'function') return;
      reply(Object.fromEntries(userIds.slice(0, 100).filter(isId).map(id => [id, online.has(id)])));
    });

    // Typing indicator goes straight to the other person; messages
    // themselves are sent through the REST API so they are saved first
    socket.on('typing_start', (data) => {
      if (data && isId(data.receiverId)) socket.to(data.receiverId).emit('user_typing', { userId });
    });

    socket.on('typing_stop', (data) => {
      if (data && isId(data.receiverId)) socket.to(data.receiverId).emit('user_stopped_typing', { userId });
    });

    socket.on('disconnect', () => {
      const left = (online.get(userId) || 1) - 1;
      if (left > 0) {
        online.set(userId, left);
      } else {
        online.delete(userId);
        socket.broadcast.emit('user_status_change', { userId, status: 'offline' });
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error.message);
    });
  });

  console.log('Socket.io initialized');
  return io;
};

const getIO = () => {
  if (!io) {
    if (process.env.NODE_ENV !== 'test') console.warn('Socket.io not initialized');
    return null;
  }
  return io;
};

// Utility functions for emitting events from controllers
const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(userId.toString()).emit(event, data);
  }
};

const emitToEvent = (eventId, event, data) => {
  if (io) {
    io.to(`event:${eventId}`).emit(event, data);
  }
};

const emitToRoom = (roomId, event, data) => {
  if (io) {
    io.to(roomId).emit(event, data);
  }
};

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
  emitToEvent,
  emitToRoom
};
