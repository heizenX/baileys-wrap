import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	outDir: 'lib',
	dts: true,
	clean: true,
	minify: true,
	fixedExtension: false,
	tsconfig: './tsconfig.json', // explícito
});
