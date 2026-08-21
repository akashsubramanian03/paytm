import config from '../config.js';
import { ApiError } from '../lib/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No API route for ${req.method} ${req.originalUrl}`));
}

const PRISMA_MESSAGES = {
  P2002: ['CONFLICT', 409, 'That value is already taken.'],
  P2025: ['NOT_FOUND', 404, 'That record no longer exists.'],
};

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  const prismaMapping = PRISMA_MESSAGES[err?.code];
  if (prismaMapping) {
    const [code, status, message] = prismaMapping;
    const target = err?.meta?.target;
    return res.status(status).json({
      error: {
        code,
        message: target ? `That ${String(target).replace(/_/g, ' ')} is already registered.` : message,
      },
    });
  }

  if (err?.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Request body was not valid JSON.' } });
  }

  console.error('[unhandled]', err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      ...(config.isDev ? { debug: err?.message, stack: err?.stack?.split('\n').slice(0, 5) } : {}),
    },
  });
}
