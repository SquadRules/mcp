Two independent concerns co-located under src/ui/:

- i18n: `index.ts` bootstraps i18next with react-i18next, pins language to `en`, namespace `translation`, and inlines the single resource bundle from `en.json`. There is no runtime loader — only one locale is shipped.
- theme: `tokens.css` is the single entry point that `@import`s `tokens-shared.css` (structural tokens on `:root`: spacing, typography, radius, layout limits) followed by `tokens-theme-light.css` (default semantic color variables on `:root`) and `tokens-theme-dark.css` (same variables redefined under `html[data-theme="dark"]`). New themes are added by creating a `tokens-theme-*.css` file and importing it from `tokens.css`, as documented in the header comment.

Dependency direction is one-way: components consume these assets; nothing inside this module imports from the rest of the app.