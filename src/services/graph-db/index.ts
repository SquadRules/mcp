/**
 * Graph Database Service exports
 */

export { GraphDatabaseService } from './graph-database.service.js';

// Backend-neutral model and the narrow port the runtime programs against.
export type {
  AdapterNode,
  AdapterNodeWriteOptions,
  AnomalyFilter,
  AnomalyNode,
  ConceptNode,
  EvolutionProposalNode,
  GraphActor,
  HistoryFilter,
  InheritanceEdge,
  InstanceNode,
  PathToRootResult,
  ProposalConfirmation,
  ProposalFilter,
  ProposalStatus,
  ResolvedInheritance,
  VersionAppendInput,
  VersionNode
} from './graph-types.js';
export { GraphVersionConflictError } from './graph-types.js';
export type { GraphRepository } from './graph-repository.js';

// Shared inheritance merge: one implementation, both backends.
export {
  INHERITANCE_IDENTITY_FIELDS,
  mergeResolvedProperties
} from './inheritance-merge.js';

// Shared backend: ArangoDB <= 3.11 over its HTTP API (no driver dependency).
export { ArangoGraphRepository } from './arango/arango-graph-repository.js';
export type { ArangoCapabilities } from './arango/arango-schema.js';

// Graph lifecycle: openGraphDb (factory, caller owns close) / initGraphDb (boot
// adapter, registered for shutdown) / closeGraphDb (closes boot instances only).
export {
  closeGraphDb,
  initGraphDb,
  openGraphDb,
  type OpenGraphDbOptions
} from './graph-db-singleton.js';

// Graph ownership: the graph belongs to the store it was opened for.
export { attachGraphDb, detachGraphDb, getGraphDb } from './graph-owner.js';

// Scope identity: `adapter:<spaceId>:<slug>`, resolved from the write tenant
// context or the stored record's space_id — never guessed.
export {
  ADAPTER_KEY_PREFIX,
  adapterGraphKey,
  parseAdapterGraphKey,
  parentScopeCandidates,
  scopeMetadata,
  storedAdapterScope,
  writeAdapterScope,
  type AdapterGraphScope,
  type AdapterScopeSource
} from './adapter-scope.js';

// Topology projection from stored records (services layer; resources never own it).
export {
  defaultReconcileSpaceIds,
  projectAdapterLineage,
  reconcileAdapterGraphFromStore,
  resolveParentScope,
  syncAdapterGraph,
  type AdapterGraphSyncReport
} from './adapter-graph-sync.js';
export {
  groupRecordsByAdapter,
  inheritanceFromStoredRecord,
  resolveStoredAdapterSnapshot,
  resolveStoredAdapterLayers,
  resolveStoredParentSnapshot,
  snapshotFromLayers,
  snapshotFromStoredMemory,
  snapshotsFromRecords,
  type AdapterRecordSource,
  type StoredAdapterSnapshot
} from './adapter-graph-records.js';

// Adapter inheritance validation (Touchpoint 3): structural validators and types.
export {
  STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS,
  OVERRIDABLE_FRONTMATTER_FIELDS,
  parseOverrideList,
  isInheritsArray,
  validateInheritanceFrontmatter,
  type StructuralErrorCode,
  type StructuralWarningCode,
  type StructuralError,
  type StructuralWarning,
  type InheritanceFrontmatter,
  type InheritanceValidationResult
} from './adapter-inheritance.js';
