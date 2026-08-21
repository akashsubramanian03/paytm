import crypto from 'node:crypto';

/**
 * Stamps every request with an id.
 *
 * The consent audit log is only useful if you can tell which rows belong
 * together: one scoring call reads several data types and writes one USE row per
 * type, and without a shared id those rows are just a pile of unrelated reads.
 * With one, "show me everything that produced this report" is a single query.
 */
export function requestId(req, _res, next) {
  req.requestId = crypto.randomUUID();
  next();
}

export default requestId;
