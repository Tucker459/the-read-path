/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from /the-read-path/, so built asset URLs
// need the repository name as a base. Dev and preview stay at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/the-read-path/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
