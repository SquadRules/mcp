/**
 * ID Generator Service for SQUADRULES
 *
 * Generates UUID-based identifiers for knowledge items.
 * Uses URI-based UUIDv5 for deterministic Qdrant IDs where appropriate.
*/

import { v5 as uuidv5, v4 as uuidv4 } from 'uuid';
import { structuredLogger } from '../utils/structured-logger.js';

// SQUADRULES namespace UUID for deterministic ID generation
// Generate once and hardcode for deployment consistency
export const SQUADRULES_NAMESPACE = '6f1d7e2b-8f7b-4b1e-9c8f-2f2f0b1a2e11';

export class IDGenerator {
    /**
     * Generate a protocol ID for protocols
     * This ID is shared across all steps in a protocol sequence
     * Uses full UUID for native Qdrant support
     *
     * @returns RFC 4122 UUID v4 string
     */
    static generateProtocolId(): string {
        return uuidv4();
    }

    /**
     * Generate a deterministic protocol_id from domain/type/task combination
     * This ensures the same domain/type/task always gets the same protocol_id
     *
     * @param domain - Knowledge domain
     * @param type - Knowledge type
     * @param task - Task identifier
     * @returns Deterministic UUIDv5 string
     */
    static generateDeterministicProtocolId(domain: string, type: string, task: string): string {
        const input = `${domain}:${type}:${task}`;
        return uuidv5(input, SQUADRULES_NAMESPACE);
    }

    /**
    /**
     * Generate a deterministic adapter UUID (v5) from a label
     * Label is normalized (trim, collapse spaces, lower-case)
     */
    static generateAdapterUUIDv5(label: string): string {
        const normalized = (label || '').trim().replace(/\s+/g, ' ').toLowerCase();
        return uuidv5(normalized, SQUADRULES_NAMESPACE);
    }

    /**
     * Generate a UUID for unified protocol
     * Used for squadrules://UUID URIs in the unified store protocol
     *
     * @returns RFC 4122 UUID v4 string
     */
    static generateUUID(): string {
        return crypto.randomUUID();
    }

    /**
     * Build Qdrant ID from human-readable URI using deterministic UUIDv5
     *
     * This enables URI-based retrieval: given a URI, we can always regenerate
     * the exact same Qdrant ID for direct lookup.
     *
     * @param humanUri - Full human-readable URI (e.g., "squadrules://adapter/{slug}")
     * @returns Deterministic UUIDv5 string
     *
     * @example
     * buildQdrantId("squadrules://700468C5-2C80-4502-B60B-9A8C74044A35")
     * // Returns: "700468C5-2C80-4502-B60B-9A8C74044A35" (direct UUID)
     */
    static buildQdrantId(humanUri: string): string {
        return uuidv5(humanUri, SQUADRULES_NAMESPACE);
    }

    /**
     * Convert a canonical squadrules:// URI to a Qdrant point ID.
     *
     * Bare-UUID segments are returned as-is; everything else is hashed
     * deterministically with UUIDv5 against the SquadRules namespace so the
     * same URI always maps to the same point ID.
     *
     * @param uri - Full URI string (squadrules://…)
     * @returns UUID string for Qdrant operations
     */
    static qdrantIdFromUri(uri: string): string {
        structuredLogger.debug(`qdrantIdFromUri called with URI: ${uri}`);

        // squadrules://layer/{uuid}[?execution_id=…] → direct id
        const layerMatch = uri.match(/^squadrules:\/\/layer\/([^/?#]+)/i);
        if (layerMatch?.[1]) {
            const id = layerMatch[1];
            if (/^[0-9a-fA-F-]{32,36}$/.test(id)) {
                return id;
            }
        }

        // squadrules://{rest} → bare UUID passthrough, otherwise deterministic v5 hash
        const simpleMatch = uri.match(/^squadrules:\/\/([\s\S]*)$/i);
        if (simpleMatch) {
            const candidate = simpleMatch[1] ?? '';
            if (/^[0-9a-fA-F-]{32,36}$/.test(candidate)) {
                return candidate;
            }
            return IDGenerator.buildQdrantId(uri);
        }

        throw new Error(`Unsupported URI format: ${uri}`);
    }

    // Using UUIDs exclusively going forward
}
