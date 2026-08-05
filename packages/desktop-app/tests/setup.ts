import { vi } from 'vitest';

// Suppress console.error and console.warn during tests to avoid log pollution
// from intentional error cases and negative test scenarios.
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
