const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io = null;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:4200',
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
    console.log(`User connected: ${socket.user.name} (${socket.user._id})`);

    // Join personal room for notifications
    socket.join(socket.user._id.toString());

    // Handle joining event rooms
    socket.on('join_event', (eventId) => {
      socket.join(`event:${eventId}`);
      console.log(`${socket.user.name} joined event room: ${eventId}`);
    });

    socket.on('leave_event', (eventId) => {
      socket.leave(`event:${eventId}`);
      console.log(`${socket.user.name} left event room: ${eventId}`);
    });

    // Handle joining chat rooms
    socket.on('join_chat', (otherUserId) => {
      const roomId = [socket.user._id.toString(), otherUserId].sort().join(':');
      socket.join(`chat:${roomId}`);
      console.log(`${socket.user.name} joined chat room: ${roomId}`);
    });

    socket.on('leave_chat', (otherUserId) => {
      const roomId = [socket.user._id.toString(), otherUserId].sort().join(':');
      socket.leave(`chat:${roomId}`);
    });

    // Handle direct messages
    socket.on('send_message', (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.user._id.toString(), receiverId].sort().join(':');

      // Emit to chat room
      io.to(`chat:${roomId}`).emit('new_message', {
        sender: socket.user,
        message,
        timestamp: new Date()
      });

      // Also emit to receiver's personal room for notification
      io.to(receiverId).emit('message_notification', {
        sender: socket.user,
        message: message.substring(0, 50)
      });
    });

    // Handle typing indicator
    socket.on('typing_start', (data) => {
      const { receiverId } = data;
      const roomId = [socket.user._id.toString(), receiverId].sort().join(':');
      socket.to(`chat:${roomId}`).emit('user_typing', {
        userId: socket.user._id,
        name: socket.user.name
      });
    });

    socket.on('typing_stop', (data) => {
      const { receiverId } = data;
      const roomId = [socket.user._id.toString(), receiverId].sort().join(':');
      socket.to(`chat:${roomId}`).emit('user_stopped_typing', {
        userId: socket.user._id
      });
    });

    // Handle event updates
    socket.on('event_update', (data) => {
      const { eventId, update } = data;
      io.to(`event:${eventId}`).emit('event_updated', {
        eventId,
        update,
        updatedBy: socket.user
      });
    });

    // Handle task updates
    socket.on('task_update', (data) => {
      const { eventId, taskId, update } = data;
      io.to(`event:${eventId}`).emit('task_updated', {
        taskId,
        update,
        updatedBy: socket.user
      });
    });

    // Handle RSVP updates
    socket.on('rsvp_update', (data) => {
      const { eventId, rsvp } = data;
      io.to(`event:${eventId}`).emit('rsvp_updated', {
        rsvp,
        user: socket.user
      });
    });

    // Handle online status
    socket.on('user_online', () => {
      socket.broadcast.emit('user_status_change', {
        userId: socket.user._id,
        status: 'online'
      });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.user.name} (${reason})`);
      socket.broadcast.emit('user_status_change', {
        userId: socket.user._id,
        status: 'offline'
      });
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  console.log('Socket.io initialized');
  return io;
};

const getIO = () => {
  if (!io) {
    console.warn('Socket.io not initialized');
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
