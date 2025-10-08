const mongoose = require('mongoose');

/**
 * Connect to MongoDB with a few safety improvements:
 * - Accepts MONGO_URI or MONGODB_URI (some platforms use different names)
 * - Adds a small retry/backoff to avoid transient network flakiness during deploys
 * - Does NOT call process.exit so a single failing API route won't bring down the whole process
 *
 * Usage: await connectDB();
 */
const connectDB = async ({ retries = 3, backoffMs = 1000 } = {}) => {
  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

  if (!mongoURI) {
    const err = new Error('MongoDB URI is not defined. Set MONGO_URI or MONGODB_URI in environment variables');
    console.error(err.message);
    // Throw so callers (API routes) can handle the error instead of exiting the process
    throw err;
  }

  let attempt = 0;
  while (attempt < retries) {
    try {
      attempt += 1;
      // Use mongoose.connect which returns a promise
      await mongoose.connect(mongoURI, {
        // let mongoose pick sensible defaults; these options can be added if needed
        // keepAlive: true,
        // useNewUrlParser: true,
        // useUnifiedTopology: true,
      });

      console.log('MongoDB connected successfully');
      return mongoose.connection;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt} failed:`, err && err.message ? err.message : err);
      if (attempt >= retries) {
        // Exhausted retries — throw to caller so they can decide what to do
        const finalErr = new Error('MongoDB connection failed after ' + attemptsOr(attempt) + ' attempts: ' + (err && err.message ? err.message : err));
        console.error(finalErr.message);
        throw finalErr;
      }
      // Wait before retrying (exponential backoff)
      const wait = backoffMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }
};

function attemptsOr(n) {
  return typeof n === 'number' ? n : String(n);
}

module.exports = connectDB;