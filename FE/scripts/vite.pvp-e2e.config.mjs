import { mergeConfig } from 'vite'
import baseConfig from '../vite.config.ts'

// This config is only used for the isolated E2E artifact. It never changes the production auth build:
// DEV=true makes the existing, explicitly gated VITE_AUTH_BYPASS usable by the two test principals.
export default mergeConfig(baseConfig, {
  define: { 'import.meta.env.DEV': 'true' },
})
