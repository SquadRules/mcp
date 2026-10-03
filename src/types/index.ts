/**
 * SQUADRULES Type Definitions
 *
 * Simplified data structures for Stage 1 implementation
 */

// Core SQUADRULES memory structure - removed in favor of Qdrant SDK types
// Individual items are now represented as Qdrant points with embedded metadata

export class SquadrulesError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode: number = 500,
        public details?: Record<string, any> // Add details field for additional error context
    ) {
        super(message);
        this.name = 'SquadrulesError';
    }
}

// Quality metrics for knowledge items
export interface QualityMetrics {
    retrievalCount: number;
    successCount: number;
    partialCount: number;
    failureCount: number;
    lastRated: string | null;
    lastRater: string | null;
    qualityBonus: number;
    usageContext: string | null;

    // Implementation Success Rate fields
    implementation_stats?: ImplementationStats;
    healer_contributions?: HealerContributions;
    step_success_rates?: Record<string, StepSuccessRate>;
}

// Implementation statistics for success rate calculations
export interface ImplementationStats {
    total_attempts: number;           // Total times this knowledge was attempted
    success_attempts: number;         // Times it was successfully implemented
    model_success_rates: Record<string, ModelImplementationData>; // Per-model success tracking
    confidence_level: number;         // 0-1 confidence based on usage patterns
    last_implementation_attempt: string | null; // ISO timestamp
}

// Per-model implementation data for fairness calculations
export interface ModelImplementationData {
    attempts: number;                 // How many times this model tried this knowledge
    successes: number;                // How many times this model succeeded
    success_rate: number;             // Calculated success rate (0-1)
    wilson_lower: number;             // Wilson score interval lower bound
    wilson_upper: number;             // Wilson score interval upper bound
    last_attempt: string | null;      // ISO timestamp of last attempt
}

// Healer contributions tracking
export interface HealerContributions {
    total_healers: number;            // Number of models that improved this knowledge
    total_improvements: number;       // Total improvement actions taken
    healer_bonus_distributed: number;  // Total bonus points given to healers
    last_healed: string | null;       // ISO timestamp of last healing action
    healer_models: Record<string, HealerModelData>; // Per-healer tracking
}

// Per-healer model data
export interface HealerModelData {
    improvements_made: number;        // Number of improvements this healer made
    bonus_earned: number;             // Total bonus earned for healing
    last_healing_action: string | null; // ISO timestamp
}

// Protocol step success rate tracking
export interface StepSuccessRate {
    step_number: number;              // Protocol step number
    total_attempts: number;           // Total attempts on this step
    success_attempts: number;         // Successful implementations of this step
    success_rate: number;             // Calculated success rate (0-1)
    common_failures: string[];        // Common failure patterns observed
    last_attempt: string | null;      // ISO timestamp
}

