# Arimo 1.33 (dev-only)

Source for the outlined glyphs in `src/print/glyphOutlines.generated.ts` (print-shop PDFs carry no fonts).
Never bundled: `npm run generate:glyphs` reads these files and writes the outlines.

- Fonts: `Arimo-Regular.ttf`, `Arimo-Bold.ttf` from
  [googlefonts/Arimo](https://github.com/googlefonts/Arimo) `fonts/ttf` at commit
  `4a6255f269916ae7ad3fc2706b0935e7621396b8` (Version 1.33). Its outlines and advances match Liberation
  Sans 2.1.5, and its advances match the Helvetica AFM within 0.5/1000 em for every glyph used.
- Licence: SIL Open Font License 1.1, no Reserved Font Name (`OFL.txt`, from the same commit; also shipped
  as `public/licenses/Arimo-OFL.txt`).
