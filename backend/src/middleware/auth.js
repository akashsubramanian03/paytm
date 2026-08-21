import { authenticateToken } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';

/**
 * Gate for every protected route. Attaches req.user (with account) and
 * req.sessionId. Rejects with 401 so the frontend can bounce to /signin.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (!token || scheme.toLowerCase() !== 'bearer') {
      throw ApiError.unauthorized('You need to sign in to continue.');
    }
    const { user, sessionId } = await authenticateToken(token);
    req.user = user;
    req.sessionId = sessionId;
    return next();
  } catch (err) {
    return next(err);
  }
}
