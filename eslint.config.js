// ESLint configuration for the project.
// Uses the recommended TypeScript rules, turns off rules that clash with Prettier,
// and enforces the architecture rule: code in src/domain/ must never import storage or HTTP code.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config files at the project root are plain JS, so skip type-aware checks for them.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The domain layer is pure: it must not know about storage, routes or services.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)storage(/|$)',
              message: 'Domain code must not import from src/storage/. Keep domain functions pure.',
            },
            {
              regex: '(^|/)(routes|services)(/|$)',
              message: 'Domain code must not import from routes or services.',
            },
            {
              group: ['node:http', 'node:https', 'better-sqlite3'],
              message: 'Domain code must not import HTTP or database libraries.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
