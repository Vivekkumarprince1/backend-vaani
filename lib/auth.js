import jwt from 'jsonwebtoken';

export const authenticate = (req) => {
  const token = req.headers.get('x-auth-token');

  if (!token) {
    throw new Error('No token, authorization denied');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (err) {
    throw new Error('Token is not valid');
  }
};