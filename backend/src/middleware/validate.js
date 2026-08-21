import { ApiError } from '../lib/errors.js';

/**
 * Validates req.body / req.query / req.params against zod schemas.
 * Parsed output lands on `req.valid` — handlers must read from there, never
 * from the raw request, so unvalidated client input can never reach the DB.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const key of ['body', 'params', 'query']) {
    const schema = schemas[key];
    if (!schema) continue;
    const result = schema.safeParse(req[key]);
    if (!result.success) {
      return next(
        ApiError.badRequest(
          'VALIDATION_ERROR',
          'Please check the details you entered.',
          result.error.issues.map((issue) => ({
            field: issue.path.join('.') || key,
            message: issue.message,
          })),
        ),
      );
    }
    req.valid[key] = result.data;
  }
  return next();
};
