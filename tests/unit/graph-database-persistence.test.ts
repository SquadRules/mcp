/**
 * LadybugDB service: inheritance resolution, persistence and error handling.
 *
 * Split from `graph-database.test.ts` (same `describe` parent, same temp-database
 * setup) so each file stays readable; the node/edge cases stay in the first file.
 */
/**
 * Unit tests for LadybugDB Graph Database Service
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { GraphDatabaseService, AdapterNode } from '../../src/services/graph-db/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('GraphDatabaseService', () => {
  let db: GraphDatabaseService;
  const testDbPath = path.join(process.cwd(), '.test-graph-db');

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }

    db = new GraphDatabaseService(testDbPath);
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  describe('Inheritance Resolution', () => {
    it('should resolve inheritance with parent properties', async () => {
      const parent: AdapterNode = {
        key: 'adapter:parent',
        type: 'adapter',
        slug: 'parent',
        version: '1.0.0',
        title: 'Parent Adapter',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        layer_count: 5,
        contract_types: ['shell', 'forward', 'subagent'],
        space: 'personal',
        tags: ['review', 'quality']
      };

      const child: AdapterNode = {
        key: 'adapter:child',
        type: 'adapter',
        space: 'space:test',
        slug: 'child',
        version: '1.0.0',
        title: 'Child Adapter',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        frontmatter: {
          slug: 'child',
          version: '1.0.0',
          inherits: 'parent',
          override: ['tags']
        },
        tags: ['custom-tag']
      };

      await db.createAdapterNode(parent);
      await db.createAdapterNode(child);

      await db.createInheritanceEdge({
        from: 'adapter:child',
        to: 'adapter:parent',
        relationship: 'inherits',
        inherited_fields: ['contract_types', 'layer_count', 'space'],
        override_fields: ['tags'],
        created_at: '2026-01-02T00:00:00Z'
      });

      const resolved = await db.resolveInheritance('adapter:child');
      
      expect(resolved).not.toBeNull();
      expect(resolved?.adapter.slug).toBe('child');
      expect(resolved?.inheritance_chain).toHaveLength(1);
      expect(resolved?.resolved_properties.layer_count).toBe(5);
      expect(resolved?.resolved_properties.contract_types).toEqual(['shell', 'forward', 'subagent']);
    });

    it('should return null for non-existent adapter', async () => {
      const resolved = await db.resolveInheritance('adapter:non-existent');
      expect(resolved).toBeNull();
    });
  });

  describe('Persistence', () => {
    it('should persist data across database restarts', async () => {
      const adapter: AdapterNode = {
        key: 'adapter:persist-test',
        type: 'adapter',
        space: 'space:test',
        slug: 'persist-test',
        version: '1.0.0',
        title: 'Persistence Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };

      await db.createAdapterNode(adapter);
      await db.close();

      // Reopen database
      const db2 = new GraphDatabaseService(testDbPath);
      await db2.initialize();

      const retrieved = await db2.getAdapter('adapter:persist-test');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.slug).toBe('persist-test');

      await db2.close();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when database not initialized', async () => {
      const uninitializedDb = new GraphDatabaseService(testDbPath);
      
      await expect(
        uninitializedDb.getAdapter('adapter:test')
      ).rejects.toThrow('Database not initialized');
    });
  });
});
