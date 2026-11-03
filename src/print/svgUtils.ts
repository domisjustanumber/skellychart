import {PIXELS_PER_MM} from './constants.js';
import type {PaperUnits} from './papers.js';

export const MM_PER_INCH = 25.4;

export function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function rgbCss(rgb: [number, number, number]): string {
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** Convert mm → inch string for SVG/CSS (trims float noise from mm constants). */
export function mmToInchString(mm: number): string {
    const inch = mm / MM_PER_INCH;
    return inch.toFixed(4).replace(/\.?0+$/, '');
}

/** `width` / `height` attribute values for the root print `<svg>`, in the paper's units (layout math stays in mm). */
export function svgRootOuterSizeAttrs(paperWMm: number, paperHMm: number, units: PaperUnits): [string, string] {
    if (units === 'in') {
        return [`${mmToInchString(paperWMm)}in`, `${mmToInchString(paperHMm)}in`];
    }
    return [`${paperWMm}mm`, `${paperHMm}mm`];
}

/**
 * `width` / `height` for a print-shop page: inches when both sides are whole eighths of an inch (an inch
 * trim plus ⅛ in bleed), otherwise mm.
 */
export function svgRootOuterSizeAttrsUnit(mediaWMm: number, mediaHMm: number): [string, string] {
    const eighths = (mm: number) => (mm / MM_PER_INCH) * 8;
    if ([mediaWMm, mediaHMm].every((mm) => Math.abs(eighths(mm) - Math.round(eighths(mm))) < 1e-6)) {
        return [`${mmToInchString(mediaWMm)}in`, `${mmToInchString(mediaHMm)}in`];
    }
    return [`${+mediaWMm.toFixed(3)}mm`, `${+mediaHMm.toFixed(3)}mm`];
}

/**
 * A printed sheet `paperWMm` × `paperHMm`: the root `<svg>` (sized by `sizeAttrs`) round `body`. The
 * viewBox must be the exact sheet size in px (`mm * PIXELS_PER_MM`, not rounded): Letter and Tabloid are
 * not whole px, and a rounded viewBox would scale the whole chart.
 */
export function svgSheetRoot(paperWMm: number, paperHMm: number, [widthAttr, heightAttr]: [string, string], body: string): string {
    const viewBoxW = paperWMm * PIXELS_PER_MM;
    const viewBoxH = paperHMm * PIXELS_PER_MM;
    // xMidYMin: avoid default vertical centering when viewBox vs mm aspect ratios differ slightly (rounding).
    const par = 'preserveAspectRatio="xMidYMin meet"';
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `viewBox="0 0 ${+viewBoxW.toFixed(3)} ${+viewBoxH.toFixed(3)}" width="${widthAttr}" height="${heightAttr}" ${par}>` +
        body +
        `</svg>`
    );
}
