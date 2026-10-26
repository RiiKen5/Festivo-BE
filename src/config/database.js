const mongoose = require('mongoose');

let isConnected = false;

// RSVPs without an account have no attendee, so the one-RSVP-per-user index
// must only apply to signed-in RSVPs. Replace the old index if it's still there.
const migrateRsvpIndex = async () => {
  try {
    const RSVP = require('../models/RSVP');
    const indexes = await RSVP.collection.indexes();
    const old = indexes.find(i => i.name === 'event_1_attendee_1' && !i.partialFilterExpression);
    if (old) {
      await RSVP.collection.dropIndex('event_1_attendee_1');
      console.log('Replaced the RSVP (event, attendee) index to allow RSVPs without an account');
    }
    await RSVP.createIndexes();
  } catch (error) {
    console.error('RSVP index migration failed:', error.message);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 5,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    await migrateRsvpIndex();

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    console.warn('Server starting without MongoDB - API endpoints requiring database will fail');
    console.warn('To use MongoDB, either:');
    console.warn('  1. Start local MongoDB: brew services start mongodb-community');
    console.warn('  2. Use Docker: docker run -d -p 27017:27017 mongo');
    console.warn('  3. Set MONGODB_URI in .env to a MongoDB Atlas connection string');
    isConnected = false;
    // Don't exit - let server start for development
  }
};

const getConnectionStatus = () => isConnected;

module.exports = connectDB;
module.exports.getConnectionStatus = getConnectionStatus;
