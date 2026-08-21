/**
 * The engine version stamped onto every signal, score and report.
 *
 * Bumping it invalidates every cached score: pipeline/score.pipeline.js treats a
 * stored score whose engineVersion differs from this value as stale and
 * recomputes, so an engine change can never be masked by a cached number.
 */
import config from '../config.js';

export const ENGINE_VERSION = config.nambikai.engineVersion;

export default ENGINE_VERSION;
