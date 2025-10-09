const mongoose = require('mongoose');

/**
 * Idempotent MongoDB connector.
 * - Ensures only one connection attempt happens (cached promise)
 * - If mongoose is already connected, returns the existing connection immediately
 * - Keeps the existing retry/backoff behaviour for the initial connect
 *
 * Usage:
 *   const connectDB = require('./lib/db');
 *   await connectDB(); // safe to call multiple times
 */

let connectionPromise = null;

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;

const connectDB = async ({ retries = DEFAULT_RETRIES, backoffMs = DEFAULT_BACKOFF_MS } = {}) => {
  // If already connected, return the mongoose connection immediately
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If a connection attempt is already in progress, return that promise so callers wait on the same attempt
  if (connectionPromise) return connectionPromise;

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

  if (!mongoURI) {
    const err = new Error('MongoDB URI is not defined. Set MONGO_URI or MONGODB_URI in environment variables');
    console.error(err.message);
    // Throw so callers (e.g. server startup) can handle the error instead of exiting the process silently
    throw err;
  }

  // Cache the connection promise so multiple callers wait on the same connect
  connectionPromise = (async () => {
    let attempt = 0;
    while (attempt < retries) {
      try {
        attempt += 1;
        // Use mongoose.connect which returns a promise
        await mongoose.connect(mongoURI, {
          // rely on mongoose defaults; override via env if needed
        });

        console.log('MongoDB connected successfully');
        return mongoose.connection;
      } catch (err) {
        console.error(`MongoDB connection attempt ${attempt} failed:`, err && err.message ? err.message : err);
        if (attempt >= retries) {
          const finalErr = new Error('MongoDB connection failed after ' + attemptsOr(attempt) + ' attempts: ' + (err && err.message ? err.message : err));
          console.error(finalErr.message);
          // Reset cached promise so future attempts can retry (e.g., after operator fixes network)
          connectionPromise = null;
          throw finalErr;
        }
        // Wait before retrying (exponential backoff)
        const wait = backoffMs * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  })();

  return connectionPromise;
};

function attemptsOr(n) {
  return typeof n === 'number' ? n : String(n);
}

module.exports = connectDB;