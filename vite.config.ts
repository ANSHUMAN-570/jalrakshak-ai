import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The jsdom UI tests type into real forms, so under parallel load they can exceed vitest's 5 s default.
  test: { environment: 'node', testTimeout: 20_000 },
})
