import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: a `test` key there would be an
// unknown option to `vite build`. Nothing under test touches React or the DOM —
// src/lib is pure TypeScript — so no plugins and no jsdom are needed.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
