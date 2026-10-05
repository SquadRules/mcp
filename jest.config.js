/**
 * Jest Configuration for squadrules MCP Server
 * Fixed for working test discovery
 */

const strict = process.env.STRICT_COVERAGE === 'true';

export default {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: [
        '**/*.test.ts',
        '**/*.test.js',
        '**/*.spec.ts',
        '**/*.spec.js',
    ],
    testPathIgnorePatterns: ['/node_modules/', '/tests/ui/'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            useESM: true,
            tsconfig: {
                target: 'ES2022',
                module: 'ES2022',
                moduleResolution: 'NodeNext',
                isolatedModules: true,
            },
        }],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        // CJS stub: real `uuid` is ESM; transitive CJS (e.g. dockerode) must require() a .cjs mock.
        '^uuid$': '<rootDir>/tests/mocks/uuid-stub.cjs',
    },
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/__tests__/**',
        '!tests/**',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThreshold: {
        global: strict ? {
            branches: 100,
            functions: 100,
            lines: 100,
            statements: 100,
        } : {
            // 99% target passes tests; report shows if below 100%
            branches: 99,
            functions: 99,
            lines: 99,
            statements: 99,
        },
    },
    // Environment loading now handled once by globalSetup (tests/global-setup-auth.ts)
    // env-loader.ts kept to preserve Jest configuration structure (prevents 85+ redundant dotenv logs)
    // setup-qdrant-fetch-compat.ts mirrors the Qdrant fetch shim the server installs at boot.
    setupFiles: ['<rootDir>/tests/env-loader.ts', '<rootDir>/tests/setup-qdrant-fetch-compat.ts'],
    // Global test setup runs before all tests
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    // When AUTH_ENABLED=true: start Keycloak + server, write .test-auth-env.dev.json
    globalSetup: '<rootDir>/tests/global-setup-auth.ts',
    // When AUTH_ENABLED=true: stop server and Keycloak container
    globalTeardown: '<rootDir>/tests/global-teardown-auth.ts',
    // Global test timeout
    testTimeout: 10000,
    // Run train/update tests before v2-squadrules-search (which depends on them)
    testSequencer: '<rootDir>/tests/jest-sequencer.cjs',
};
