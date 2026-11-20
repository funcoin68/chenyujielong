/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // json-summary writes coverage/coverage-summary.json — the file
      // scripts/check_coverage_floor.py reads for the stage-6 coverage gate.
      reporter: ['text', 'json-summary'],
      // Gate measures logic code only until component tests arrive —
      // untested UI shells would sit below the 70% floor forever.
      include: ['src/lib/**'],
    },
  },
})
