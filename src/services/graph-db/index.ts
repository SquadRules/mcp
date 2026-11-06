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
