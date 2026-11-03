/**
 * The print-shop controls: board size, unit, bleed and crop marks, the page-size readout, the order note
 * for the shop and the one-line summary of the board.
 */
import {workingDistanceMinSquareMm} from '../print/charucoLayout.js';
import {shopStandardBleedMm, type ShopSizeId} from '../print/charucoDocUrl.js';
import {
    bleedMmForUnit,
    formatShopBleed,
    formatShopDims,
    formatShopTrim,
    pageSizeMm,
    SHOP_TRIM_MAX_MM,
    shopBleedChoices,
    shopSizeById,
    shopSizeGroups,
    shopSizeOptionLabel,
} from '../print/shopSizes.js';
import {maxShopSquareMm, shopQuietZoneMm, snapShopSquareMm} from '../print/shopLayout.js';
import {applyAutoPreset, IMPERIAL, setSquareFollowingBand, shopLayoutNow, state, storeShopOptions} from './appState.js';
import {byId} from './dom.js';
import {chartSizeVars, distanceLabel, interpolate, S} from './strings.js';

/** What a print-shop control does to the rest of the page; given to {@link wireShopControls}. */
export interface ShopControlHooks {
    /** The user took over the board. */
    takeOverBoard(): void;
    clearTransientNotices(): void;
    syncUi(): void;
}

/** Shown under the board size after picking a size too small for the working distance; cleared by the next change. */
let shopSizeHint: string | null = null;

export function clearShopSizeHint(): void {
    shopSizeHint = null;
}

/** The print-shop size, unit, bleed and crop-mark controls, the page size and the order note; shop mode only. */
export function syncShopControls(): void {
    for (const btn of byId('shopUnitToggle').querySelectorAll<HTMLButtonElement>('[data-unit]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.unit === state.shopUnit));
    }

    // Sizes this grid cannot fit at any square length are listed but disabled.
    const sizeSel = byId('shopSize') as HTMLSelectElement;
    const sizeKey = `${state.shopUnit}|${state.squaresX}x${state.squaresY}`;
    if (sizeSel.dataset.key !== sizeKey) {
        sizeSel.dataset.key = sizeKey;
        sizeSel.innerHTML = '';
        for (const group of shopSizeGroups(state.shopUnit)) {
            const og = document.createElement('optgroup');
            og.label = group.unit === 'in' ? S.shopSizeGroupIn : S.shopSizeGroupMm;
            for (const size of group.sizes) {
                const o = document.createElement('option');
                o.value = size.id;
                const label = shopSizeOptionLabel(size, state.shopUnit);
                const fits = maxShopSquareMm(state.squaresX, state.squaresY, size.id) !== null;
                o.textContent = fits ? label : interpolate(S.shopSizeTooSmall, {size: label});
                o.disabled = !fits;
                og.appendChild(o);
            }
            sizeSel.appendChild(og);
        }
    }
    sizeSel.value = state.shopSizeId ?? '';

    const layout = shopLayoutNow();
    byId('shopSizeDetail').textContent = layout
        ? interpolate(S.shopSizeDetail, {
              trim: formatShopTrim(layout.trimWMm, layout.trimHMm, state.shopUnit),
              ...chartSizeVars(state.squaresX * state.squareMm, state.squaresY * state.squareMm, state.shopUnit === 'in'),
          })
        : '';
    // The largest sizes are the walk-in cap: say why there is nothing bigger.
    const atCap = state.shopSizeId === '36x48in' || state.shopSizeId === '900x1200mm';
    const hint = [shopSizeHint, atCap ? S.shopCapNote : null].filter((h) => h !== null).join(' ');
    const hintEl = byId('shopSizeHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('hidden', hint === '');

    const bleedSel = byId('shopBleed') as HTMLSelectElement;
    const choices = shopBleedChoices(state.shopUnit);
    const current = state.shopBleed === 'std' ? 'std' : String(state.shopBleed.mm);
    const values = choices.map((c) => (c === 'std' ? 'std' : String(c.mm)));
    const bleedKey = `${state.shopUnit}|${values.includes(current) ? '' : current}`;
    if (bleedSel.dataset.key !== bleedKey) {
        bleedSel.dataset.key = bleedKey;
        bleedSel.innerHTML = '';
        const otherUnit = state.shopUnit === 'in' ? 'mm' : 'in';
        const labels = [
            interpolate(S.shopBleedStd, {bleed: formatShopBleed(shopStandardBleedMm(state.shopUnit))}),
            S.shopBleedNone,
            S.shopBleed5,
            S.shopBleed10,
            S.shopBleedQuarter,
            interpolate(S.shopBleedOther, {bleed: formatShopBleed(shopStandardBleedMm(otherUnit)), unit: otherUnit}),
        ];
        values.forEach((value, i) => bleedSel.add(new Option(labels[i], value)));
        if (!values.includes(current)) {
            // A link may carry any bleed up to 25 mm; show it rather than silently change it.
            bleedSel.add(new Option(formatShopBleed(Number(current)), current));
        }
    }
    bleedSel.value = current;

    const pageEl = byId('shopPageSize');
    if (layout) {
        const bleedMm = bleedMmForUnit(state.shopBleed, state.shopUnit);
        const page = pageSizeMm({wMm: layout.trimWMm, hMm: layout.trimHMm}, bleedMm, state.shopCropMarks);
        const pageDims = formatShopDims(page.wMm, page.hMm, state.shopUnit);
        const trimDims = formatShopDims(layout.trimWMm, layout.trimHMm, state.shopUnit).replace(/ (mm|in)$/, '');
        const extras = [
            bleedMm > 0 ? interpolate(S.shopPageBleed, {bleed: formatShopBleed(bleedMm)}) : null,
            state.shopCropMarks ? S.shopPageMarks : null,
        ].filter((e) => e !== null);
        pageEl.textContent = extras.length
            ? interpolate(S.shopPageSize, {page: pageDims, trim: trimDims, extras: extras.join(' + ')})
            : interpolate(S.shopPageSizeExact, {page: pageDims});
    } else {
        pageEl.textContent = '';
    }
    (byId('shopCropMarks') as HTMLInputElement).checked = state.shopCropMarks;

    const orderText = layout ? shopOrderText(layout) : '';
    const orderEl = byId('shopOrderText');
    if (orderEl.textContent !== orderText) {
        orderEl.textContent = orderText;
        byId('copyOrderStatus').textContent = '';
    }
}

/**
 * The note for the shop: print at 100%, the file and trim size, the board, colour handling and how to check
 * the squares on delivery. It carries the same facts as the slug and the PDF subject.
 */
function shopOrderText(layout: NonNullable<ReturnType<typeof shopLayoutNow>>): string {
    const unit = state.shopUnit;
    const bleedMm = bleedMmForUnit(state.shopBleed, unit);
    const trim = formatShopTrim(layout.trimWMm, layout.trimHMm, unit);
    const page = pageSizeMm({wMm: layout.trimWMm, hMm: layout.trimHMm}, bleedMm, state.shopCropMarks);
    const pageDims = formatShopDims(page.wMm, page.hMm, unit);
    const bleed = formatShopBleed(bleedMm);
    let pageLine: string;
    if (state.shopCropMarks) {
        const included = bleedMm > 0 ? interpolate(S.shopOrderBleedIncluded, {bleed}) : S.shopOrderNoBleed;
        pageLine = interpolate(S.shopOrderPageMarks, {page: pageDims, trim, bleed: included});
    } else {
        pageLine = bleedMm > 0 ? interpolate(S.shopOrderPage, {page: pageDims, trim, bleed}) : interpolate(S.shopOrderPageExact, {trim});
    }
    // 5 mm foam flexes past 24 × 36 in, so bigger boards need a stiffer substrate.
    const large = Math.max(layout.trimWMm, layout.trimHMm) > 914.4 + 1e-6;
    const n = Math.max(2, Math.min(state.squaresX, Math.floor(300 / state.squareMm)));
    const lines = [
        interpolate(S.shopOrderChart, {squaresX: state.squaresX, squaresY: state.squaresY, mm: state.squareMm}),
        S.shopOrderScale,
        pageLine,
        large ? S.shopOrderBoardLarge : S.shopOrderBoardSmall,
        S.shopOrderColour,
        interpolate(S.shopOrderCheck, {n, total: n * state.squareMm, mm: state.squareMm}),
    ];
    // Near the walk-in cap, say why the board cannot be bigger.
    const e = shopQuietZoneMm(state.squareMm);
    const needW = layout.content.w + 2 * e;
    const needH = layout.content.h + 2 * e;
    if (Math.min(needW, needH) >= SHOP_TRIM_MAX_MM[0] - 25 || Math.max(needW, needH) >= SHOP_TRIM_MAX_MM[1] - 25) {
        lines.push(S.shopCapNote);
    }
    return lines.join('\n');
}

async function copyShopOrder(): Promise<void> {
    const text = byId('shopOrderText').textContent ?? '';
    const status = byId('copyOrderStatus');
    try {
        await navigator.clipboard.writeText(text);
        status.textContent = S.shopOrderCopied;
    } catch {
        // No clipboard access (permissions, insecure context): select the note so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(byId('shopOrderText'));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = S.shopOrderCopyManual;
    }
}

/** Print-shop summary: one board, its trim (toggled unit first), orientation, grid and square length. */
export function shopSummaryText(layout: ReturnType<typeof shopLayoutNow>): string {
    if (!layout) {
        return S.layoutCannotFit;
    }
    return interpolate(S.shopSummary, {
        trim: formatShopTrim(layout.trimWMm, layout.trimHMm, state.shopUnit),
        orientation: layout.landscape ? S.landscape : S.portrait,
        squaresX: state.squaresX,
        squaresY: state.squaresY,
        mm: state.squareMm,
    });
}

/** Wires the print-shop controls and the order note's copy button; called once in boot. */
export function wireShopControls(hooks: ShopControlHooks): void {
    for (const btn of byId('shopUnitToggle').querySelectorAll<HTMLButtonElement>('[data-unit]')) {
        btn.addEventListener('click', () => {
            state.shopUnit = btn.dataset.unit === 'in' ? 'in' : 'mm';
            // An untouched preset picks its board size in the new unit.
            applyAutoPreset();
            hooks.syncUi();
        });
    }
    (byId('shopSize') as HTMLSelectElement).addEventListener('change', (e) => {
        const sizeId = (e.target as HTMLSelectElement).value as ShopSizeId;
        hooks.takeOverBoard();
        hooks.clearTransientNotices();
        state.shopSizeId = sizeId;
        // Keep the board; re-fit only the square, staying in the working distance's band if the size allows.
        const bandMin = workingDistanceMinSquareMm(state.distanceId);
        let squareMm = snapShopSquareMm(state.squareMm, state.squaresX, state.squaresY, sizeId, bandMin);
        if (squareMm === null) {
            squareMm = maxShopSquareMm(state.squaresX, state.squaresY, sizeId);
            if (squareMm !== null) {
                shopSizeHint = interpolate(S.shopSizeBandHint, {
                    distance: distanceLabel(state.distanceId, IMPERIAL),
                    size: shopSizeById(sizeId).name,
                    mm: squareMm,
                });
            }
        }
        if (squareMm !== null) {
            setSquareFollowingBand(squareMm);
        }
        hooks.syncUi();
    });
    (byId('shopBleed') as HTMLSelectElement).addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        state.shopBleed = v === 'std' ? 'std' : {mm: Number(v)};
        storeShopOptions();
        hooks.syncUi();
    });
    (byId('shopCropMarks') as HTMLInputElement).addEventListener('change', (e) => {
        state.shopCropMarks = (e.target as HTMLInputElement).checked;
        storeShopOptions();
        hooks.syncUi();
    });

    byId('btnCopyOrder').addEventListener('click', () => void copyShopOrder());
}
