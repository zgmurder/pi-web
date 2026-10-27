# Bundled Noto Sans Mono

Unmodified variable font from [google/fonts](https://github.com/google/fonts/tree/097bc1b8c04c3224087c2ae95f7a923859b778cf/ofl/notosansmono), commit `097bc1b8c04c3224087c2ae95f7a923859b778cf`.

- Original filename: `NotoSansMono[wdth,wght].ttf`
- Local filename: `NotoSansMono-Variable.ttf`
- SHA-256: `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081`
- License: SIL Open Font License 1.1, included verbatim in `OFL.txt`.

`app/layout.tsx` uses Next.js `next/font/local` to serve this font from the application, with weights 100–900 and normal width. Development and builds need no Google Fonts connection. Keep the font and license together when distributing source. The existing `--font-noto-mono` variable and user font overrides are unchanged; Chinese glyphs still use the existing system-font fallback stack.
