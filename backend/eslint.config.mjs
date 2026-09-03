import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Deliberately close to the recommended presets. The rules that are tightened
 * are the ones that map to real failure modes in this service: a floating
 * promise around a database write loses data silently, and an unchecked `any`
 * from a JWT payload is how an authorisation check gets skipped.
 */
export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // An unawaited query is a lost write.
            "@typescript-eslint/no-floating-promises": "error",
            // `checksVoidReturn.arguments` is off because Express 4 route
            // handlers are legitimately `async` — Express ignores the returned
            // promise and each handler catches its own errors. Leaving it on
            // flags every route in the app and hides the real cases, which are
            // promises used in conditions.
            "@typescript-eslint/no-misused-promises": [
                "error",
                { checksVoidReturn: { arguments: false, attributes: false } },
            ],
            // `catch (e) {}` around auth logic hides the reason a token failed.
            "no-empty": ["error", { allowEmptyCatch: false }],
            // Tolerated: the JWT payload and the jsonb columns are genuinely
            // untyped at the boundary. Flagged, not fatal.
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
            ],
        },
    },
);
