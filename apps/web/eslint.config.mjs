import next from "eslint-config-next";

const config = [
  ...next,
  {
    // ESLint is pinned to 9.x here: eslint-config-next 16's plugins (react
    // 7.37, import 2.32) don't support ESLint 10's APIs yet.
    settings: { react: { version: "19.3" } },
    rules: {
      // Colours come from design tokens only (app/globals.css). A hex literal in
      // a className or style is almost always a token that should exist.
      // (esquery can't parse `{n,m}` or `\b` inside selector regexes; the rule
      // silently matched nothing until it was written out like this. The trailing
      // group stops anchors like #features from reading as the colour #fea.)
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]([0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])?([0-9a-fA-F][0-9a-fA-F])?([^0-9a-zA-Z]|$)/]",
          message: "Use a design token (bg-primary, text-muted-foreground, …) instead of a hex colour.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]([0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])?([0-9a-fA-F][0-9a-fA-F])?([^0-9a-zA-Z]|$)/]",
          message: "Use a design token (bg-primary, text-muted-foreground, …) instead of a hex colour.",
        },
      ],
    },
  },
  { ignores: [".next/**", "next-env.d.ts"] },
];

export default config;
