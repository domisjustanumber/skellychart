/**
 * Advance widths (1/1000 em) of Helvetica and Helvetica-Bold from Adobe's Core 14 AFM metrics
 * (Helvetica 001.006, Helvetica-Bold 001.007; the AFM files may be used and distributed
 * for any purpose). Helvetica is a PDF standard font, so these are the widths Save as PDF draws with,
 * and Arial (the usual stand-in where Helvetica is not installed) shares them.
 *
 * Text that must lay out identically on every device (the origin banner) is measured here rather
 * than with a browser canvas, whose result depends on the fonts installed.
 */

/** Widths for U+0020–U+007E, indexed by code point − 0x20. */
const ASCII: Record<'normal' | 'bold', readonly number[]> = {
    normal: [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ],
    bold: [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    ],
};

/** Widths for the Latin-1 and WinAnsi punctuation code points the PDF standard encoding can draw. */
const EXTRA: Record<'normal' | 'bold', Readonly<Record<number, number>>> = {
    normal: {
        0x00A0: 278, 0x00A1: 333, 0x00A2: 556, 0x00A3: 556, 0x00A4: 556, 0x00A5: 556, 0x00A6: 260, 0x00A7: 556,
        0x00A8: 333, 0x00A9: 737, 0x00AA: 370, 0x00AB: 556, 0x00AC: 584, 0x00AD: 333, 0x00AE: 737, 0x00AF: 333,
        0x00B0: 400, 0x00B1: 584, 0x00B4: 333, 0x00B5: 556, 0x00B6: 537, 0x00B7: 278, 0x00B8: 333, 0x00BA: 365,
        0x00BB: 556, 0x00BC: 834, 0x00BD: 834, 0x00BE: 834, 0x00BF: 611, 0x00C0: 667, 0x00C1: 667, 0x00C2: 667,
        0x00C3: 667, 0x00C4: 667, 0x00C5: 667, 0x00C6: 1000, 0x00C7: 722, 0x00C8: 667, 0x00C9: 667, 0x00CA: 667,
        0x00CB: 667, 0x00CC: 278, 0x00CD: 278, 0x00CE: 278, 0x00CF: 278, 0x00D0: 722, 0x00D1: 722, 0x00D2: 778,
        0x00D3: 778, 0x00D4: 778, 0x00D5: 778, 0x00D6: 778, 0x00D7: 584, 0x00D8: 778, 0x00D9: 722, 0x00DA: 722,
        0x00DB: 722, 0x00DC: 722, 0x00DD: 667, 0x00DE: 667, 0x00DF: 611, 0x00E0: 556, 0x00E1: 556, 0x00E2: 556,
        0x00E3: 556, 0x00E4: 556, 0x00E5: 556, 0x00E6: 889, 0x00E7: 500, 0x00E8: 556, 0x00E9: 556, 0x00EA: 556,
        0x00EB: 556, 0x00EC: 278, 0x00ED: 278, 0x00EE: 278, 0x00EF: 278, 0x00F0: 556, 0x00F1: 556, 0x00F2: 556,
        0x00F3: 556, 0x00F4: 556, 0x00F5: 556, 0x00F6: 556, 0x00F7: 584, 0x00F8: 611, 0x00F9: 556, 0x00FA: 556,
        0x00FB: 556, 0x00FC: 556, 0x00FD: 500, 0x00FE: 556, 0x00FF: 500, 0x2013: 556, 0x2014: 1000, 0x2018: 222,
        0x2019: 222, 0x201C: 333, 0x201D: 333, 0x2022: 350, 0x2026: 1000, 0x2122: 1000,
    },
    bold: {
        0x00A0: 278, 0x00A1: 333, 0x00A2: 556, 0x00A3: 556, 0x00A4: 556, 0x00A5: 556, 0x00A6: 280, 0x00A7: 556,
        0x00A8: 333, 0x00A9: 737, 0x00AA: 370, 0x00AB: 556, 0x00AC: 584, 0x00AD: 333, 0x00AE: 737, 0x00AF: 333,
        0x00B0: 400, 0x00B1: 584, 0x00B4: 333, 0x00B5: 611, 0x00B6: 556, 0x00B7: 278, 0x00B8: 333, 0x00BA: 365,
        0x00BB: 556, 0x00BC: 834, 0x00BD: 834, 0x00BE: 834, 0x00BF: 611, 0x00C0: 722, 0x00C1: 722, 0x00C2: 722,
        0x00C3: 722, 0x00C4: 722, 0x00C5: 722, 0x00C6: 1000, 0x00C7: 722, 0x00C8: 667, 0x00C9: 667, 0x00CA: 667,
        0x00CB: 667, 0x00CC: 278, 0x00CD: 278, 0x00CE: 278, 0x00CF: 278, 0x00D0: 722, 0x00D1: 722, 0x00D2: 778,
        0x00D3: 778, 0x00D4: 778, 0x00D5: 778, 0x00D6: 778, 0x00D7: 584, 0x00D8: 778, 0x00D9: 722, 0x00DA: 722,
        0x00DB: 722, 0x00DC: 722, 0x00DD: 667, 0x00DE: 667, 0x00DF: 611, 0x00E0: 556, 0x00E1: 556, 0x00E2: 556,
        0x00E3: 556, 0x00E4: 556, 0x00E5: 556, 0x00E6: 889, 0x00E7: 556, 0x00E8: 556, 0x00E9: 556, 0x00EA: 556,
        0x00EB: 556, 0x00EC: 278, 0x00ED: 278, 0x00EE: 278, 0x00EF: 278, 0x00F0: 611, 0x00F1: 611, 0x00F2: 611,
        0x00F3: 611, 0x00F4: 611, 0x00F5: 611, 0x00F6: 611, 0x00F7: 584, 0x00F8: 611, 0x00F9: 611, 0x00FA: 611,
        0x00FB: 611, 0x00FC: 611, 0x00FD: 556, 0x00FE: 611, 0x00FF: 556, 0x2013: 556, 0x2014: 1000, 0x2018: 278,
        0x2019: 278, 0x201C: 500, 0x201D: 500, 0x2022: 350, 0x2026: 1000, 0x2122: 1000,
    },
};

/** Characters outside the tables (which Helvetica cannot draw in a PDF anyway) count as a full em. */
const FALLBACK_WIDTH = 1000;

/** Unkerned advance width of `text` in px at `fontPx`; kerning only ever narrows these strings. */
export function helveticaTextWidthPx(text: string, fontPx: number, bold = false): number {
    const style = bold ? 'bold' : 'normal';
    let units = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        units += (cp >= 0x20 && cp <= 0x7e ? ASCII[style][cp - 0x20] : EXTRA[style][cp]) ?? FALLBACK_WIDTH;
    }
    return (units * fontPx) / 1000;
}
