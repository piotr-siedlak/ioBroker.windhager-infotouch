import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                allowDefaultProject: { allow: ['*.mjs'] },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-returns': 'off',
        },
    },
    {
        // node:test's describe()/it() return promises that the runner tracks itself; test doubles may be async-without-await.
        files: ['test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        ignores: ['build/**', 'node_modules/**', 'test/*.js', '.dev-server/**', '*.config.mjs'],
    },
];
