/**
 * Graph Database Service exports
 */

export {
  GraphDatabaseService,
  type AdapterNode,
  type ConceptNode,
  type InheritanceEdge,
  type PathToRootResult,
  type ResolvedInheritance
} from './graph-database.service.js';

// Boot-time singleton (Touchpoint 1): getGraphDbService / initGraphDb / closeGraphDb.
export {
  closeGraphDb,
  getGraphDbService,
  initGraphDb
} from './graph-db-singleton.js';

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
