// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/**
 * URI Builder for SQUADRULES Resources
 *
 * Generates canonical kairos:// URIs for:
 * - Domain/type/task resources: kairos://{domain}/{type}/{task}
 * - Protocol steps: kairos://{domain}/{type}/{task}/step/{n}
 * - Unified UUID resources: kairos://{uuid}
 * - Templates: kairos://templates/{template_type}/{param}
 */

/**
 * Build kairos://{domain}/{type}/{task} URI for domain/type/task format
 *
 * @param domain - Knowledge domain (e.g., 'typescript', 'docker')
 * @param type - Knowledge type (e.g., 'rule', 'pattern', 'context')
 * @param task - Task identifier (e.g., 'error-handling', 'networking')
 * @returns kairos:// domain/type/task URI
 *
 * @example
 * buildDomainTypeTaskURI('docker', 'pattern', 'networking')
 * // Returns: 'kairos://docker/pattern/networking'
 */
export function buildDomainTypeTaskURI(domain: string, type: string, task: string): string {
    if (!domain || !type || !task) {
        throw new Error('buildDomainTypeTaskURI requires domain, type, and task parameters');
    }

    // Validate domain/type/task format (lowercase, alphanumeric, hyphens)
    const validFormat = /^[a-z0-9-]+$/;
    if (!validFormat.test(domain) || !validFormat.test(type) || !validFormat.test(task)) {
        throw new Error('Domain, type, and task must be lowercase alphanumeric with hyphens only');
    }

    return `kairos://${domain}/${type}/${task}`;
}

/**
 * Build kairos://{domain}/{type}/{task}/step/{step} URI for protocol steps
 *
 * @param domain - Knowledge domain
 * @param type - Knowledge type
 * @param task - Task identifier
 * @param step - Step number (1-based)
 * @returns kairos:// protocol step URI
 *
 * @example
 * buildProtocolStepURI('ai', 'rule', 'coding-rules', 3)
 * // Returns: 'kairos://ai/rule/coding-rules/step/3'
 */
export function buildProtocolStepURI(domain: string, type: string, task: string, step: number): string {
    if (!domain || !type || !task || step === undefined || step === null) {
        throw new Error('buildProtocolStepURI requires domain, type, task, and step parameters');
    }

    if (!Number.isInteger(step) || step < 1) {
        throw new Error('Step must be a positive integer');
    }

    // Validate domain/type/task format
    const validFormat = /^[a-z0-9-]+$/;
    if (!validFormat.test(domain) || !validFormat.test(type) || !validFormat.test(task)) {
        throw new Error('Domain, type, and task must be lowercase alphanumeric with hyphens only');
    }

    return `kairos://${domain}/${type}/${task}/step/${step}`;
}
