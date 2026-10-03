import crypto from 'node:crypto';

/** Hash used as proof_hash for step 1 (no prior proof). */
export const GENESIS_HASH = crypto.createHash('sha256').update('genesis').digest('hex');
