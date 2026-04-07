// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.ts', '**/*.tsx'];
const jsFiles = ['**/*.js', '**/*.cjs', '**/*.mjs'];

const tsTypeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    files: tsFiles,
  }),
);

export default tseslint.config(
  {
    ignores: ['dist/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tsTypeCheckedConfigs,
  eslintPluginPrettierRecommended,
  {
    files: tsFiles,
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    files: jsFiles,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
    },
    rules: {
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    files: ['ops/loadtest/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        __ENV: 'readonly',
      },
    },
  },
);
