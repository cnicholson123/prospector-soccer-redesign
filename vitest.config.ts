import { defineConfig } from 'vitest/config';
// Bound filesystem/scrypt contention as integration coverage grows. Individual
// tests still exercise concurrent writers; their timeouts and assertions stay intact.
export default defineConfig({ test: { maxWorkers: 4, include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: process.env.DATABASE_URL ? 60000 : 5000, hookTimeout: process.env.DATABASE_URL ? 60000 : 10000 } });
