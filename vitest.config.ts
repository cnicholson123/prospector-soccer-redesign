import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: process.env.DATABASE_URL ? 60000 : 5000, hookTimeout: process.env.DATABASE_URL ? 60000 : 10000 } });
