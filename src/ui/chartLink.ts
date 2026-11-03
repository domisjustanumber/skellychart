/**
 * The chart link: opening the board a link or scanned QR code describes (with its notices and the scan
 * card), and keeping the address bar's chart query in step with the controls.
 */
import {APP_VERSION} from '../appVersion.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    BOARD_MARKERS_MAX,
    boardGridAxisMax,
    CHARUCO_SQUARE_MM_MIN,
    snapSquareMm,
    workingDistanceTierFromSquareLengthMm,
} from '../print/charucoLayout.js';
import {compareChartVersions, parseChartVersion} from '../print/chartVersion.js';
import {
    buildCharucoDocumentationUrl,
    parseCharucoQrSearchParams,
    shopStandardBleedMm,
    type PrintMode,
} from '../print/charucoDocUrl.js';
import {SHOP_SQUARE_MM_MAX, shopSizeById} from '../print/shopSizes.js';
import {shopSheetLayout, smallestFittingShopSize} from '../print/shopLayout.js';
import {clampInt, linkTarget, paperDims, setSquareFollowingBand, state} from './appState.js';
import {byId} from './dom.js';
import {PREVIEW_DEBOUNCE_IDLE_MS} from './preview.js';
import {FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL, interpolate, paperLabel, S} from './strings.js';

/** Set from chart QR link query params; shown once at load (not cleared by `syncUi`). */
let qrVersionBannerMessage: string | null = null;

/**
 * Square length (mm) a chart link asked for that could not print on the current paper. A paper change
 * re-fits from it (so switching to the chart's paper restores it) until the user moves a board control.
 */
let linkSquareMm: number | null = null;

/** Keeps the address bar's packed chart query (`b`) in step with the QR / exported chart; drops legacy keys. */
function syncAddressBarChartQuery(): void {
    const {squaresX, squaresY} = state;
    const u = new URL(buildCharucoDocumentationUrl(window.location.href, squaresX, squaresY, state.squareMm, linkTarget()));
    const next = `${u.pathname}${u.search}${u.hash}`;
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === cur) {
        return;
    }
    try {
        window.history.replaceState(history.state, '', next);
    } catch {
        // Rate-limited (WebKit throws past 100 calls in 30 s); the next change writes it again.
    }
}

let addressBarTimer: number | null = null;

/** Trailing debounce for {@link syncAddressBarChartQuery}, so a slider drag does not rewrite the URL every frame. */
export function scheduleAddressBarSync(): void {
    if (addressBarTimer !== null) {
        window.clearTimeout(addressBarTimer);
    }
    addressBarTimer = window.setTimeout(() => {
        addressBarTimer = null;
        syncAddressBarChartQuery();
    }, PREVIEW_DEBOUNCE_IDLE_MS);
}

/**
 * The chart a scanned QR code described; the scan card shows once per tab. A chart printed with the banner
 * off may have no measured-length box (a single sheet has none), so the card does not point to one.
 */
let scannedChart: {squaresX: number; squaresY: number; squareMm: number; shop: boolean; banner: boolean} | null = null;

/** The scan card for the scanned chart, hidden once closed; its two actions close it and call `setMode`. */
export function renderScanCard(setMode: (mode: PrintMode) => void): void {
    const card = byId('scanCard');
    if (!scannedChart) {
        card.classList.add('hidden');
        card.replaceChildren();
        return;
    }
    const p = (text: string, className?: string): HTMLParagraphElement => {
        const el = document.createElement('p');
        el.textContent = text;
        if (className) {
            el.className = className;
        }
        return el;
    };
    const title = p(
        interpolate(S.scanCardTitle, {squaresX: scannedChart.squaresX, squaresY: scannedChart.squaresY, mm: scannedChart.squareMm}),
        'scan-card-title',
    );
    title.id = 'scanCardTitle';
    const docs = document.createElement('p');
    const a = document.createElement('a');
    a.href = FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = S.scanCardDocs;
    docs.appendChild(a);
    const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    };
    const close = (): void => {
        scannedChart = null;
        renderScanCard(setMode);
    };
    const actions = document.createElement('div');
    actions.className = 'scan-card-actions';
    actions.append(
        button(S.scanCardPrintAnother, 'btn btn-secondary', () => {
            close();
            setMode('home');
        }),
        button(S.scanCardOrder, 'btn btn-secondary', () => {
            close();
            setMode('shop');
        }),
    );
    const dismiss = button('×', 'scan-card-dismiss', close);
    dismiss.setAttribute('aria-label', S.scanCardDismiss);
    card.replaceChildren(
        title,
        p(scannedChart.banner ? S.scanCardMeasure : S.scanCardMeasureNoBox),
        ...(scannedChart.shop ? [p(S.scanCardFlat)] : []),
        docs,
        actions,
        dismiss,
    );
    card.classList.remove('hidden');
}

export function applyQrQueryFromLocation(): void {
    const sp = new URLSearchParams(window.location.search);
    const parsed = parseCharucoQrSearchParams(sp);
    const warnings: string[] = [];

    const currentVersion = parseChartVersion(APP_VERSION);
    if (
        parsed.chartVersionRaw !== null &&
        parsed.chartVersion !== null &&
        currentVersion !== null &&
        compareChartVersions(parsed.chartVersion, currentVersion) > 0
    ) {
        warnings.push(
            interpolate(S.qrChartNewer, {
                theirs: parsed.chartVersionRaw,
                ours: APP_VERSION,
            }),
        );
    }

    if (parsed.squaresX !== null || parsed.squaresY !== null || parsed.squareLengthMm !== null) {
        const seen = (history.state as {skScanSeen?: boolean} | null)?.skScanSeen === true;
        if (!seen && parsed.squaresX !== null && parsed.squaresY !== null && parsed.squareLengthMm !== null) {
            scannedChart = {
                squaresX: parsed.squaresX,
                squaresY: parsed.squaresY,
                squareMm: parsed.squareLengthMm,
                shop: parsed.printMode === 'shop',
                banner: parsed.banner,
            };
            history.replaceState({...(history.state as object | null), skScanSeen: true}, '');
        }
        state.autoGrid = false;
        if (parsed.squaresX !== null) {
            state.squaresX = clampInt(parsed.squaresX, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        if (parsed.squaresY !== null) {
            state.squaresY = clampInt(parsed.squaresY, BOARD_GRID_MIN, BOARD_GRID_MAX);
        }
        // Older generators let a board outgrow the marker dictionary; keep X and end-stop Y as the slider does.
        const linkedSquaresY = state.squaresY;
        state.squaresY = Math.min(state.squaresY, boardGridAxisMax(state.squaresX));
        if (state.squaresY !== linkedSquaresY) {
            warnings.push(
                interpolate(S.qrGridClamped, {
                    theirs: `${state.squaresX} × ${linkedSquaresY}`,
                    ours: `${state.squaresX} × ${state.squaresY}`,
                    markers: BOARD_MARKERS_MAX,
                }),
            );
        }
        if (parsed.paperId !== null) {
            state.paperId = parsed.paperId;
        }
        state.banner = parsed.banner;
        if (parsed.printMode === 'shop') {
            applyShopLink(parsed, warnings);
        }
    }
    if (state.mode !== 'shop' && (parsed.squaresX !== null || parsed.squaresY !== null || parsed.squareLengthMm !== null)) {
        const pd = paperDims();
        if (parsed.squareLengthMm !== null) {
            state.squareMm = Math.round(parsed.squareLengthMm);
        }
        const linkedSquareMm = state.squareMm;
        const snapped = snapSquareMm(state.squareMm, state.squaresX, state.squaresY, pd.wMm, pd.hMm, state.banner);
        if (snapped !== null) {
            state.squareMm = snapped;
        }
        // A link is not a slider: pick the largest distance whose minimum this square length meets.
        state.distanceId = workingDistanceTierFromSquareLengthMm(state.squareMm);
        linkSquareMm = state.squareMm !== linkedSquareMm ? linkedSquareMm : null;
    }

    qrVersionBannerMessage = warnings.length ? warnings.join(' ') : null;
}

/**
 * A print-shop link (`t` field) reopens the board on its size, unit, bleed and crop marks. A size that is
 * unreadable or no longer fits falls back to the default size; a board no size fits opens for home paper.
 * Each fallback adds a notice. The board itself (X, Y, square length) is kept exactly.
 */
function applyShopLink(parsed: ReturnType<typeof parseCharucoQrSearchParams>, warnings: string[]): void {
    if (parsed.shopSize) {
        state.shopUnit = parsed.shopSize.unit;
    }
    if (parsed.shopOptionsError) {
        warnings.push(S.qrShopOptionsFallback);
    }
    if (parsed.shopOptions) {
        const {bleed, cropMarks} = parsed.shopOptions;
        // The standard bleed written as its fixed value is still the standard bleed.
        const isStd = bleed !== 'std' && Math.abs(bleed.mm - shopStandardBleedMm(state.shopUnit)) < 1e-9;
        state.shopBleed = isStd ? 'std' : bleed;
        state.shopCropMarks = cropMarks;
    }
    if (parsed.squareLengthMm !== null) {
        state.squareMm = clampInt(parsed.squareLengthMm, CHARUCO_SQUARE_MM_MIN, SHOP_SQUARE_MM_MAX);
    }
    state.distanceId = workingDistanceTierFromSquareLengthMm(state.squareMm);
    const {squaresX, squaresY, squareMm} = state;
    if (parsed.shopSize && shopSheetLayout(squaresX, squaresY, squareMm, parsed.shopSize.id)) {
        state.mode = 'shop';
        state.shopSizeId = parsed.shopSize.id;
        return;
    }
    const fallback = smallestFittingShopSize(squaresX, squaresY, squareMm, state.shopUnit);
    if (!fallback) {
        warnings.push(S.qrShopTooLarge);
        return;
    }
    state.mode = 'shop';
    state.shopSizeId = fallback;
    const ours = shopSizeById(fallback).name;
    warnings.push(
        parsed.shopSize
            ? interpolate(S.qrShopSizeNoFit, {theirs: shopSizeById(parsed.shopSize.id).name, ours})
            : interpolate(S.qrShopSizeFallback, {size: ours}),
    );
}

/** The user took over the board: stop re-fitting to the link's square length and drop its notice. */
export function forgetLinkSquare(): void {
    if (linkSquareMm !== null) {
        linkSquareMm = null;
        syncQrVersionBanner();
    }
}

export function syncQrVersionBanner(): void {
    const el = byId('qrVersionBanner');
    const snapNotice =
        linkSquareMm === null
            ? null
            : interpolate(S.qrSquareSnapped, {
                  theirs: linkSquareMm,
                  ours: state.squareMm,
                  paper: paperLabel(state.paperId),
              });
    const message = [qrVersionBannerMessage, snapNotice].filter((m) => m !== null).join(' ');
    if (message) {
        el.textContent = message;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
        el.textContent = '';
    }
}

/**
 * After a paper or banner change, keep the board the user set (or opened from a link); re-fit only the
 * square length, from the link's own size while it is still pending, so the chart's paper restores it
 * exactly.
 */
export function refitSquareToPaper(): void {
    const pd = paperDims();
    const wanted = linkSquareMm ?? state.squareMm;
    const snapped = snapSquareMm(wanted, state.squaresX, state.squaresY, pd.wMm, pd.hMm, state.banner);
    if (snapped !== null) {
        setSquareFollowingBand(snapped);
    }
    if (linkSquareMm !== null && state.squareMm === linkSquareMm) {
        linkSquareMm = null;
    }
    syncQrVersionBanner();
}
