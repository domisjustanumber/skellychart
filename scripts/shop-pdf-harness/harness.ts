/**
 * Exposes `window.buildShopPdf` for scripts/check-shop-pdf.ts: renders a print-shop sheet and builds its
 * PDF with the app's own code, returning the PDF as base64 with the boxes it was given.
 */
import type {ShopPrintOptions, ShopSizeChoice} from '../../src/print/charucoDocUrl.js';
import {shopSheetLayout} from '../../src/print/shopLayout.js';
import {renderShopPrintSvg, SHOP_CMYK_BY_RGB, shopPdfProperties} from '../../src/print/shopSheet.js';
import {buildPdfBlobFromSvgPages} from '../../src/ui/pdfExport.js';

interface Request {
    squaresX: number;
    squaresY: number;
    squareMm: number;
    size: ShopSizeChoice;
    options: ShopPrintOptions;
}

async function buildShopPdf(r: Request) {
    const layout = shopSheetLayout(r.squaresX, r.squaresY, r.squareMm, r.size.id);
    if (!layout) {
        throw new Error(`${r.squaresX}×${r.squaresY} at ${r.squareMm} mm does not fit ${r.size.id}`);
    }
    const sheet = await renderShopPrintSvg({...r, layout, documentationSourceUrl: 'https://skelly.cam/c/'});
    const blob = await buildPdfBlobFromSvgPages(
        [{svg: sheet.svg, widthMm: sheet.mediaMm.w, heightMm: sheet.mediaMm.h}],
        undefined,
        {
            shop: {
                trimBoxMm: sheet.trimBoxMm,
                bleedBoxMm: sheet.bleedBoxMm,
                cmykByRgb: SHOP_CMYK_BY_RGB,
                ...shopPdfProperties({...r, layout, chartUrl: sheet.chartUrl}),
            },
        },
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {pdf: btoa(binary), mediaMm: sheet.mediaMm, trimBoxMm: sheet.trimBoxMm, bleedBoxMm: sheet.bleedBoxMm, chartUrl: sheet.chartUrl};
}

(window as unknown as {buildShopPdf: typeof buildShopPdf}).buildShopPdf = buildShopPdf;
document.title = 'ready';
