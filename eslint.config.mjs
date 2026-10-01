import parser from '@typescript-eslint/parser';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';

const plugins = { 'n8n-nodes-base': n8nNodesBase };

export default [
	{ ignores: ['dist/**', 'node_modules/**', 'test/**', '**/*.js', '**/*.mjs'] },
	{
		// The community rules walk package.json as an AST. That only works
		// because @typescript-eslint/parser hands a .json file to TypeScript's
		// own JSON parser; espree rejects the same file as a syntax error.
		files: ['package.json'],
		languageOptions: { parser, ecmaVersion: 'latest', sourceType: 'module' },
		plugins,
		rules: {
			...n8nNodesBase.configs.community.rules,
			'n8n-nodes-base/community-package-json-name-still-default': 'off',
		},
	},
	{
		files: ['credentials/**/*.ts'],
		languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
		plugins,
		rules: {
			...n8nNodesBase.configs.credentials.rules,
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts'],
		languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
		plugins,
		rules: n8nNodesBase.configs.nodes.rules,
	},
];
