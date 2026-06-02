import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        testTimeout: 30_000,
        environmentOptions: {
            jsdom: {
                url: "http://localhost",
            },
        },
    },
    resolve: {
        alias: {
            src: "/src",
        },
    },
});