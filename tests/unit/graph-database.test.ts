/**
 * Unit tests for LadybugDB Graph Database Service
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { GraphDatabaseService, AdapterNode, InheritanceEdge } from '../../src/services/graph-db/index.js';
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

  describe('Initialization', () => {
    it('should initialize database successfully', () => {
      expect(db.isInitialized()).toBe(true);
    });

    it('should create database directory', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should return correct database path', () => {
      expect(db.getDatabasePath()).toBe(testDbPath);
    });
  });

  describe('Adapter Node Operations', () => {
    it('should create an adapter node', async () => {
      const adapter: AdapterNode = {
        key: 'adapter:test-adapter',
        type: 'adapter',
        slug: 'test-adapter',
        version: '1.0.0',
        title: 'Test Adapter',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        frontmatter: {
          slug: 'test-adapter',
          version: '1.0.0'
        },
        layer_count: 2,
        contract_types: ['shell', 'forward'],
        space: 'personal',
        tags: ['test'],
        metadata: { author: 'test-user' }
      };

      await db.createAdapterNode(adapter);
      const retrieved = await db.getAdapter('adapter:test-adapter');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.slug).toBe('test-adapter');
      expect(retrieved?.version).toBe('1.0.0');
      expect(retrieved?.title).toBe('Test Adapter');
    });

    it('should retrieve all adapters', async () => {
      const adapter1: AdapterNode = {
        key: 'adapter:adapter-1',
        type: 'adapter',
        space: 'space:test',
        slug: 'adapter-1',
        version: '1.0.0',
        title: 'Adapter 1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };

      const adapter2: AdapterNode = {
        key: 'adapter:adapter-2',
        type: 'adapter',
        space: 'space:test',
        slug: 'adapter-2',
        version: '2.0.0',
        title: 'Adapter 2',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z'
      };

      await db.createAdapterNode(adapter1);
      await db.createAdapterNode(adapter2);

      const allAdapters = await db.getAllAdapters();
      expect(allAdapters).toHaveLength(2);
      expect(allAdapters.map(a => a.slug)).toContain('adapter-1');
      expect(allAdapters.map(a => a.slug)).toContain('adapter-2');
    });

    it('should return null for non-existent adapter', async () => {
      const retrieved = await db.getAdapter('adapter:non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('Inheritance Edge Operations', () => {
    it('should create inheritance edge between adapters', async () => {
      const parent: AdapterNode = {
        key: 'adapter:parent',
        type: 'adapter',
        space: 'space:test',
        slug: 'parent',
        version: '1.0.0',
        title: 'Parent Adapter',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        layer_count: 3,
        contract_types: ['shell', 'forward']
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
          inherits: 'parent'
        }
      };

      await db.createAdapterNode(parent);
      await db.createAdapterNode(child);

      const edge: InheritanceEdge = {
        from: 'adapter:child',
        to: 'adapter:parent',
        relationship: 'inherits',
        inherited_fields: ['contract_types', 'layer_count'],
        override_fields: ['tags'],
        created_at: '2026-01-02T00:00:00Z'
      };

      await db.createInheritanceEdge(edge);

      // Verify path-to-root
      const pathToRoot = await db.findPathToRoot('adapter:child');
      expect(pathToRoot).toHaveLength(1);
      expect((pathToRoot[0].ancestor as AdapterNode).slug).toBe('parent');
    });
  });

  describe('Path-to-Root Query', () => {
    it('should find all ancestors in inheritance chain', async () => {
      const grandparent: AdapterNode = {
        key: 'adapter:grandparent',
        type: 'adapter',
        space: 'space:test',
        slug: 'grandparent',
        version: '1.0.0',
        title: 'Grandparent Adapter',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };

      const parent: AdapterNode = {
        key: 'adapter:parent',
        type: 'adapter',
        space: 'space:test',
        slug: 'parent',
        version: '1.0.0',
        title: 'Parent Adapter',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        frontmatter: {
          slug: 'parent',
          version: '1.0.0',
          inherits: 'grandparent'
        }
      };

      const child: AdapterNode = {
        key: 'adapter:child',
        type: 'adapter',
        space: 'space:test',
        slug: 'child',
        version: '1.0.0',
        title: 'Child Adapter',
        created_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
        frontmatter: {
          slug: 'child',
          version: '1.0.0',
          inherits: 'parent'
        }
      };

      await db.createAdapterNode(grandparent);
      await db.createAdapterNode(parent);
      await db.createAdapterNode(child);

      await db.createInheritanceEdge({
        from: 'adapter:parent',
        to: 'adapter:grandparent',
        relationship: 'inherits',
        created_at: '2026-01-02T00:00:00Z'
      });

      await db.createInheritanceEdge({
        from: 'adapter:child',
        to: 'adapter:parent',
        relationship: 'inherits',
        created_at: '2026-01-03T00:00:00Z'
      });

      const pathToRoot = await db.findPathToRoot('adapter:child');
      expect(pathToRoot).toHaveLength(2);
      
      const slugs = pathToRoot.map(p => (p.ancestor as AdapterNode).slug);
      expect(slugs).toContain('parent');
      expect(slugs).toContain('grandparent');
    });

    it('should return empty array for adapter with no ancestors', async () => {
      const adapter: AdapterNode = {
        key: 'adapter:standalone',
        type: 'adapter',
        space: 'space:test',
        slug: 'standalone',
        version: '1.0.0',
        title: 'Standalone Adapter',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };

      await db.createAdapterNode(adapter);

      const pathToRoot = await db.findPathToRoot('adapter:standalone');
      expect(pathToRoot).toHaveLength(0);
    });
  });

});
