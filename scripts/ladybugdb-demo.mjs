#!/usr/bin/env node
/**
 * LadybugDB Prototype Demo
 * 
 * Demonstrates core graph database operations for SquadRules 6:
 * - Creating adapter nodes
 * - Creating inheritance edges
 * - Path-to-root queries
 * - Inheritance resolution
 */

import { GraphDatabaseService } from '../dist/services/graph-db/index.js';
import * as fs from 'fs';
import * as path from 'path';

async function demo() {
  console.log('🐞 LadybugDB Prototype Demo\n');

  // Clean up any existing demo database
  const demoDbPath = path.join(process.cwd(), '.demo-graph-db');
  if (fs.existsSync(demoDbPath)) {
    fs.rmSync(demoDbPath, { recursive: true, force: true });
  }

  // Initialize database
  console.log('📦 Initializing embedded graph database...');
  const db = new GraphDatabaseService(demoDbPath);
  await db.initialize();
  console.log(`✅ Database initialized at: ${db.getDatabasePath()}\n`);

  // Create parent adapter (critic-loop)
  console.log('🔧 Creating parent adapter: critic-loop');
  const criticLoop = {
    key: 'adapter:critic-loop',
    type: 'adapter',
    slug: 'critic-loop',
    version: '2.1.0',
    title: 'Critic Loop: Delegated Review Workflow',
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-03-15T14:22:00Z',
    frontmatter: {
      slug: 'critic-loop',
      version: '2.1.0',
      protocol_version: '1.0.0'
    },
    layer_count: 3,
    contract_types: ['shell', 'forward', 'subagent'],
    space: 'personal',
    tags: ['review', 'quality-gate', 'delegated-judgment'],
    metadata: {
      author: 'jakub.plichcinski',
      last_execution: '2026-11-05T16:45:00Z'
    }
  };
  await db.createAdapterNode(criticLoop);
  console.log('✅ Created critic-loop adapter\n');

  // Create child adapter (specialized-reviewer)
  console.log('🔧 Creating child adapter: specialized-reviewer');
  const specializedReviewer = {
    key: 'adapter:specialized-reviewer',
    type: 'adapter',
    slug: 'specialized-reviewer',
    version: '1.0.0',
    title: 'Specialized Reviewer: Domain-Specific Code Review',
    created_at: '2026-04-10T09:00:00Z',
    updated_at: '2026-04-10T09:00:00Z',
    frontmatter: {
      slug: 'specialized-reviewer',
      version: '1.0.0',
      inherits: 'critic-loop',
      override: ['tags', 'metadata']
    },
    layer_count: 3,
    contract_types: ['shell', 'forward', 'subagent'],
    space: 'personal',
    tags: ['review', 'domain-specific', 'code-quality'],
    metadata: {
      author: 'jakub.plichcinski',
      domain: 'security'
    }
  };
  await db.createAdapterNode(specializedReviewer);
  console.log('✅ Created specialized-reviewer adapter\n');

  // Create inheritance edge
  console.log('🔗 Creating inheritance edge (child → parent)');
  const inheritanceEdge = {
    from: 'adapter:specialized-reviewer',
    to: 'adapter:critic-loop',
    relationship: 'inherits',
    inherited_fields: ['contract_types', 'layer_count'],
    override_fields: ['tags', 'metadata'],
    created_at: '2026-04-10T09:15:00Z',
    metadata: {
      inheritance_depth: 1,
      resolution_strategy: 'child-wins'
    }
  };
  await db.createInheritanceEdge(inheritanceEdge);
  console.log('✅ Created inheritance edge\n');

  // Execute path-to-root query
  console.log('🔍 Executing path-to-root query for specialized-reviewer...');
  const pathToRoot = await db.findPathToRoot('adapter:specialized-reviewer');
  console.log(`✅ Found ${pathToRoot.length} ancestor(s):`);
  pathToRoot.forEach((result, index) => {
    const ancestor = result.ancestor;
    console.log(`   ${index + 1}. ${ancestor.slug} (v${ancestor.version}) - depth: ${result.depth}`);
  });
  console.log();

  // Resolve inheritance
  console.log('🧬 Resolving inheritance for specialized-reviewer...');
  const resolved = await db.resolveInheritance('adapter:specialized-reviewer');
  if (resolved) {
    console.log('✅ Inheritance resolved:');
    console.log(`   Adapter: ${resolved.adapter.slug}`);
    console.log(`   Inheritance chain length: ${resolved.inheritance_chain.length}`);
    console.log(`   Resolved properties:`);
    console.log(`     - slug: ${resolved.resolved_properties.slug}`);
    console.log(`     - version: ${resolved.resolved_properties.version}`);
    console.log(`     - layer_count: ${resolved.resolved_properties.layer_count}`);
    console.log(`     - contract_types: ${JSON.stringify(resolved.resolved_properties.contract_types)}`);
    console.log(`     - tags: ${JSON.stringify(resolved.resolved_properties.tags)}`);
    console.log(`     - space: ${resolved.resolved_properties.space}`);
  }
  console.log();

  // Verify persistence
  console.log('💾 Testing database persistence...');
  await db.close();
  console.log('   Database closed');

  // Reopen database
  const db2 = new GraphDatabaseService(demoDbPath);
  await db2.initialize();
  console.log('   Database reopened');

  // Query adapter
  const adapter = await db2.getAdapter('adapter:critic-loop');
  if (adapter) {
    console.log(`✅ Persistence verified: ${adapter.slug} (v${adapter.version}) found`);
  }
  console.log();

  // List all adapters
  console.log('📋 Listing all adapters in database...');
  const allAdapters = await db2.getAllAdapters();
  console.log(`✅ Found ${allAdapters.length} adapter(s):`);
  allAdapters.forEach(a => {
    console.log(`   - ${a.slug} (v${a.version})`);
  });
  console.log();

  // Cleanup
  await db2.close();
  fs.rmSync(demoDbPath, { recursive: true, force: true });
  console.log('🧹 Demo database cleaned up\n');

  console.log('✨ Demo completed successfully!\n');
  console.log('Summary:');
  console.log('  ✅ LadybugDB initialized (embedded mode)');
  console.log('  ✅ Created adapter nodes with properties');
  console.log('  ✅ Created inheritance edges');
  console.log('  ✅ Path-to-root query works');
  console.log('  ✅ Inheritance resolution works');
  console.log('  ✅ Database persists to file');
}

demo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
