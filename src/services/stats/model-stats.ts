/**
 * ModelStatsService (orchestrator)
 *
 * Manages model performance statistics and quality scoring.
 * Delegates to modular submodules:
 * - stats-types.ts
 * - stats-scoring.ts
 * - stats-bonuses.ts
 * - stats-healer.ts
 * - stats-protocol.ts
 *
 * The orchestrator keeps minimal state and coordinates persistence via redis.
 */

import { logger } from '../../utils/structured-logger.js';
import { keyValueStore } from '../key-value-store-factory.js';
import type { QualityMetrics } from '../../types/index.js';
import type { QualityScore, StatsState, ModelStats, RecentDiscovery } from './types.js';
import {
  agentContributions,
  agentImplementationBonus,
  agentRareSuccesses,
  agentQualityScore
} from '../metrics/agent-metrics.js';
import { getTenantId } from '../../utils/tenant-context.js';

async function loadStatsState(): Promise<StatsState | null> {
    return await keyValueStore.getJson<StatsState>('stats:state');
}

async function saveStatsState(state: StatsState): Promise<void> {
    await keyValueStore.setJson('stats:state', state);
}

function ensureStatsStateShape(state?: Partial<StatsState>): StatsState {
    return {
        recentDiscoveries: (state && state.recentDiscoveries) || [],
        implementationBonuses: (state && state.implementationBonuses) || {},
        healerBonuses: (state && state.healerBonuses) || {}
    };
}

function addRecentDiscovery(state: StatsState, discovery: RecentDiscovery): void {
    state.recentDiscoveries.unshift(discovery);
    state.recentDiscoveries = state.recentDiscoveries.slice(0, 20);
    logger.debug(`Added recent discovery by ${discovery.agent} (${discovery.score}pts)`);
}

async function updateImplementationBonusHelper(state: StatsState, llm_model_id: string, bonusPoints: number): Promise<void> {
    state.implementationBonuses[llm_model_id] = (state.implementationBonuses[llm_model_id] || 0) + bonusPoints;
    logger.debug(`Implementation bonus: ${llm_model_id} earned ${bonusPoints} points`);
    await saveStatsState(state);
}

async function updateHealerBonusHelper(state: StatsState, llm_model_id: string, bonusPoints: number): Promise<void> {
    state.healerBonuses[llm_model_id] = (state.healerBonuses[llm_model_id] || 0) + bonusPoints;
    logger.debug(`Healer bonus: ${llm_model_id} earned ${bonusPoints} points`);
    await saveStatsState(state);
}

import {
    calculateQualityScore as scoringCalculateQualityScore,
    calculateStepQualityMetadata as scoringCalculateStepQualityMetadata
} from './scoring.js';
import { computeImplementationBonus } from './bonuses.js';
import { calculateHealerBonus as healerCalculate } from './healer.js';
import { calculateProtocolQualityMetadata as protocolCalculate } from './protocol.js';

export class ModelStatsService {
    private statsState: StatsState = ensureStatsStateShape();
    private initialized = false;

    // persisted summary counters
    private implementationBonusTotals: { [llm_model_id: string]: number } = {};
    private rareSuccessCounts: { [llm_model_id: string]: number } = {};

    constructor() {
        void this.init();
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        try {
            await keyValueStore.connect();

            const maybe = await loadStatsState();
            if (maybe) this.statsState = ensureStatsStateShape(maybe);

            await this.loadImplementationBonusTotals();
            await this.loadRareSuccessCounts();

            this.statsState.implementationBonuses = { ...this.implementationBonusTotals };
            this.statsState.healerBonuses = this.statsState.healerBonuses || {};

            this.initialized = true;
            logger.info('model stats: persistent');
        } catch (error) {
            logger.error('model stats: persistent init failed', error);
            // proceed with in-memory defaults
        }
    }

    private async loadImplementationBonusTotals(): Promise<void> {
        const data = await keyValueStore.hgetall('stats:implementationBonusTotals');
        if (data) {
            for (const [llm_model_id, totalStr] of Object.entries(data)) {
                this.implementationBonusTotals[llm_model_id] = parseInt(totalStr) || 0;
            }
        }
    }

    private async saveImplementationBonusTotals(): Promise<void> {
        const data: Record<string, string> = {};
        for (const [llm_model_id, total] of Object.entries(this.implementationBonusTotals)) {
            data[llm_model_id] = total.toString();
        }
        if (Object.keys(data).length > 0) {
            await keyValueStore.hsetall('stats:implementationBonusTotals', data);
        }
    }

    private async loadRareSuccessCounts(): Promise<void> {
        const data = await keyValueStore.hgetall('stats:rareSuccessCounts');
        if (data) {
            for (const [llm_model_id, countStr] of Object.entries(data)) {
                this.rareSuccessCounts[llm_model_id] = parseInt(countStr) || 0;
            }
        }
    }

    private async saveRareSuccessCounts(): Promise<void> {
        const data: Record<string, string> = {};
        for (const [llm_model_id, count] of Object.entries(this.rareSuccessCounts)) {
            data[llm_model_id] = count.toString();
        }
        if (Object.keys(data).length > 0) {
            await keyValueStore.hsetall('stats:rareSuccessCounts', data);
        }
    }

    // -----------------------
    // Scoring and metadata
    // -----------------------

    calculateQualityScore(description: string, task: string, type: string, tags: string[]): QualityScore {
        return scoringCalculateQualityScore(description, task, type, tags);
    }

    /**
     * Calculate implementation bonus and update internal totals.
     * Delegates computation to game-bonuses.computeImplementationBonus which mutates qualityMetrics.
     */
    async calculateImplementationBonus(
        qualityMetrics: QualityMetrics,
        llm_model_id: string,
        outcome: 'success' | 'partial' | 'failure'
    ): Promise<number> {
        const result = computeImplementationBonus(qualityMetrics, llm_model_id, outcome);
        const { finalBonus, rareSuccess } = result;

        if (outcome === 'success' && finalBonus > 0) {
            const tenantId = getTenantId();
            
            agentImplementationBonus.inc({ 
                agent_id: llm_model_id, 
                tenant_id: tenantId 
            }, finalBonus);
            
            if (rareSuccess) {
                agentRareSuccesses.inc({ 
                    agent_id: llm_model_id, 
                    tenant_id: tenantId 
                });
            }

            // Accumulate totals
            this.implementationBonusTotals[llm_model_id] = (this.implementationBonusTotals[llm_model_id] || 0) + finalBonus;

            if (rareSuccess) {
                this.rareSuccessCounts[llm_model_id] = (this.rareSuccessCounts[llm_model_id] || 0) + 1;
            }

            await updateImplementationBonusHelper(this.statsState, llm_model_id, finalBonus);

            // Persist totals
            await this.saveImplementationBonusTotals();
            await this.saveRareSuccessCounts();
        }

        return finalBonus;
    }

    calculateHealerBonus(
        qualityMetrics: QualityMetrics,
        llm_model_id: string,
        improvementType: 'clarify' | 'correct' | 'enhance' | 'protocol_add'
    ): number {
        const bonus = healerCalculate(qualityMetrics, llm_model_id, improvementType);
        if (bonus > 0) {
            void updateHealerBonusHelper(this.statsState, llm_model_id, bonus);
        }
        return bonus;
    }

    async updateImplementationBonus(llm_model_id: string, bonusPoints: number): Promise<void> {
        await updateImplementationBonusHelper(this.statsState, llm_model_id, bonusPoints);
    }

    async updateHealerBonus(llm_model_id: string, bonusPoints: number): Promise<void> {
        await updateHealerBonusHelper(this.statsState, llm_model_id, bonusPoints);
    }

    async processContribution(llm_model_id: string, qualityScore: QualityScore, description: string): Promise<void> {
        if (qualityScore.total < 20) return;

        const tenantId = getTenantId();
        
        // Use new quality labels directly
        const quality = qualityScore.quality;
        
        // Update metrics
        agentContributions.inc({ 
            agent_id: llm_model_id, 
            quality, 
            tenant_id: tenantId 
        });
        
        agentQualityScore.observe({ 
            agent_id: llm_model_id, 
            quality_tier: quality,
            tenant_id: tenantId 
        }, qualityScore.total);

        const discovery: RecentDiscovery = {
            agent: llm_model_id,
            title: (description && description.trim() ? description : 'Knowledge pattern stored').substring(0, 50) + '...',
            score: qualityScore.total,
            quality: qualityScore.quality,
            timestamp: new Date()
        };

        addRecentDiscovery(this.statsState, discovery);

        await saveStatsState(this.statsState);
    }

    getStatsState(): StatsState {
        return this.statsState;
    }

    getAgentStats(llm_model_id: string): ModelStats {
        const recent = this.statsState.recentDiscoveries.filter(d => d.agent === llm_model_id);
        const excellentContributions = recent.filter(d => d.quality === 'excellent').length;
        const highContributions = recent.filter(d => d.quality === 'high').length;
        const standardContributions = recent.filter(d => d.quality === 'standard').length;
        const basicContributions = recent.filter(d => d.quality === 'basic').length;

        return {
            totalContributions: recent.length,
            excellentContributions,
            highContributions,
            standardContributions,
            basicContributions,
            lastUpdated: new Date()
        };
    }

    // -----------------------
    // Protocol helpers
    // -----------------------

    calculateStepQualityMetadata(
        description: string,
        domain: string,
        task: string,
        type: string,
        tags: string[],
        executionSuccess?: 'success' | 'partial' | 'failure'
    ) {
        return scoringCalculateStepQualityMetadata(description, domain, task, type, tags, executionSuccess);
    }

    async calculateProtocolQualityMetadata(protocolId: string) {
        return await protocolCalculate(protocolId);
    }

    // -----------------------
    // Quality feedback (stub)
    // -----------------------

    processQualityFeedback(llm_model_id: string, uri: string, outcome: 'success' | 'partial' | 'failure', qualityBonus: number): void {
        logger.info(`Quality feedback: ${llm_model_id} rated ${uri} as ${outcome} (+${qualityBonus})`);
    }

    // -----------------------
    // Small accessors used by achievements factory
    // -----------------------

    private getImplementationBonusTotal(llm_model_id: string): number {
        return this.implementationBonusTotals[llm_model_id] || 0;
    }

    private getRareSuccesses(llm_model_id: string): number {
        return this.rareSuccessCounts[llm_model_id] || 0;
    }

    private getHealingActions(): number {
        // Placeholder for healer tracking; returns 0 until healing tracking is implemented
        return 0;
    }
}

export const modelStats = new ModelStatsService();