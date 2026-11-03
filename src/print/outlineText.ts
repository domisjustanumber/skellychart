/**
 * Text as filled paths, for print-shop PDFs that carry no fonts. Glyphs are the Arimo outlines in
 * `glyphOutlines.generated.ts`, placed with the unkerned Helvetica AFM advances, so the measured layout
 * (`helveticaTextWidthPx`) is exactly what is drawn. Load this module with `await import()` from the shop
 * renderer only, so the outline table stays out of the home bundle.
 */
import {GLYPH_CAP_HEIGHT_EM, GLYPH_OUTLINES, GLYPH_X_HEIGHT_EM} from './glyphOutlines.generated.js';
import {helveticaTextWidthPx} from './helveticaMetrics.js';

export interface OutlineTextOptions {
    x: number;
    y: number;
    fontPx: number;
    bold?: boolean;
    /** Like SVG `text-anchor`. */
    anchor?: 'start' | 'middle' | 'end';
    /**
     * Like SVG `dominant-baseline`: `y` is the baseline (`alphabetic`), the cap top (`hanging`) or the
     * x-height middle (`middle`).
     */
    baseline?: 'alphabetic' | 'hanging' | 'middle';
    fill?: string;
}

const round3 = (n: number) => Number(n.toFixed(3));

/** Whether every character of `text` has an outline. */
export function canOutlineText(text: string, bold = false): boolean {
    const table = bold ? GLYPH_OUTLINES.bold : GLYPH_OUTLINES.normal;
    return [...text].every((ch) => ch in table);
}

/**
 * One line of text as a single `<path>` (empty for blank text), in a `matrix(s 0 0 s tx ty)` frame with
 * s = fontPx / 1000. Throws on a character with no outline.
 */
export function outlineText(text: string, opts: OutlineTextOptions): string {
    const {x, y, fontPx, bold = false, anchor = 'start', baseline = 'alphabetic', fill = '#000'} = opts;
    const table = bold ? GLYPH_OUTLINES.bold : GLYPH_OUTLINES.normal;
    let d = '';
    let advance = 0;
    for (const ch of text) {
        const glyph = table[ch];
        if (glyph === undefined) {
            throw new RangeError(`No outline for U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} in "${text}"`);
        }
        // Coordinates come in x, y pairs after each command letter; shift every x by the pen position.
        let isX = true;
        d += glyph.replace(/[MLQZ]|-?\d+/g, (token) => {
            if (token.length === 1 && token >= 'A') {
                isX = true;
                return token;
            }
            const value = isX ? Number(token) + advance : Number(token);
            isX = !isX;
            return `${value}`;
        });
        advance += helveticaTextWidthPx(ch, 1000, bold);
    }
    if (d === '') {
        return '';
    }
    const width = (advance * fontPx) / 1000;
    const tx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    const ty =
        baseline === 'hanging'
            ? y + GLYPH_CAP_HEIGHT_EM * fontPx
            : baseline === 'middle'
              ? y + (GLYPH_X_HEIGHT_EM / 2) * fontPx
              : y;
    // The scale keeps full precision: rounding it would change every glyph's width.
    const s = Number((fontPx / 1000).toPrecision(9));
    return `<path transform="matrix(${s} 0 0 ${s} ${round3(tx)} ${round3(ty)})" fill="${fill}" d="${d}"/>`;
}
