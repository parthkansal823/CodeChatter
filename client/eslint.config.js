import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],

      // eslint-plugin-react-hooks 7.1 turned on the React Compiler checks, which
      // flag ~14 places that predate the upgrade — mostly effects that sync
      // derived state, plus a couple of components declared during render.
      // They are worth fixing, but each needs its own look, and failing the
      // whole lint run in the meantime just trains people to skip lint.
      // Warnings keep them on screen without blocking. Promote back to 'error'
      // once the list is cleared.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
])
