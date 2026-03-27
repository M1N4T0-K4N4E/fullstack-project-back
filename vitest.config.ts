import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            reportsDirectory: 'coverage',
            exclude: [
                'node_modules/',
                'tests/',
                'dist/',
                '**/*.config.ts',
                '**/*.d.ts',
                'src/db/schema.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
