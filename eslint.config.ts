import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
	globalIgnores(
		['**/*.snap', 'coverage', 'lib', 'node_modules', 'pnpm-lock.yaml'],
		'Global Ignores',
	),
	{ linterOptions: { reportUnusedDisableDirectives: 'error' } },
	{
		extends: [
			eslint.configs.recommended,
			tseslint.configs.strictTypeChecked,
			tseslint.configs.stylisticTypeChecked,
		],
		files: ['**/*.{js,ts}'],
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ['*.config.*s'] },
			},
		},
		rules: {
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
		},
	},
	{
		extends: [vitest.configs.recommended],
		files: ['**/*.test.*'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
		},
		settings: { vitest: { typecheck: true } },
	},
);
