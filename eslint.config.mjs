import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * Design-system guard rails (Neon Rink HUD).
 *
 * - Arbitrary text sizes below the 11px `micro` token (text-[7px] … text-[10px])
 * - Hex colour literals inside class strings (bg-[#0a0a0a], text-[#FFF344] …)
 *
 * Use the tokens instead: text-micro / text-caption / text-body-sm …, and
 * bg-surface-1 / text-fg-2 / text-pos / border-line …
 *
 * DS_LEVEL is "warn" while the home, teams and secondary-view workstreams
 * migrate their components; flip it to "error" once they land.
 */
const DS_LEVEL = "warn";

const SMALL_TEXT = "text-\\[(7|7\\.5|8|8\\.5|9|9\\.5|10)px\\]";
const HEX_CLASS = "-\\[#[0-9a-fA-F]{3,8}";

const smallTextMsg =
  "Text below 11px is not allowed. Use a type token (text-micro, text-caption, text-body-sm …).";
const hexMsg =
  "Hex colours in className are not allowed. Use a semantic token (bg-surface-1, text-fg-2, text-pos, border-line …) or components/ui/team-color.ts for team colours.";

// Class strings live in className="…", className={`…`} and cn()/clsx()/cva() calls.
const classContexts = [
  "JSXAttribute[name.name=/^(className|class)$/]",
  "CallExpression[callee.name=/^(cn|clsx|cva|twMerge)$/]",
];

const restricted = classContexts.flatMap((ctx) => [
  { selector: `${ctx} Literal[value=/${SMALL_TEXT}/]`, message: smallTextMsg },
  { selector: `${ctx} TemplateElement[value.raw=/${SMALL_TEXT}/]`, message: smallTextMsg },
  { selector: `${ctx} Literal[value=/${HEX_CLASS}/]`, message: hexMsg },
  { selector: `${ctx} TemplateElement[value.raw=/${HEX_CLASS}/]`, message: hexMsg },
]);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [DS_LEVEL, ...restricted],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
  ]),
]);

export default eslintConfig;
