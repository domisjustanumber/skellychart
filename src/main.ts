/**
 * Entry point: switching mode, the transient notices, syncUi and the control wiring. The board state and
 * each feature (sheets stepper, preview, print and save, print shop, chart link) live in src/ui.
 */
import {IS_DEV} from './env.js';
import freemocapLogoUrl from './freemocapLogoUrl.js';
import {
    BOARD_GRID_MAX,
    BOARD_GRID_MIN,
    CHARUCO_SQUARE_MM_MIN,
    isWorkingDistanceId,
    squareLengthTierBandEdgeFractions,
    WORKING_DISTANCES,
    workingDistanceMinSquareMm,
} from './print/charucoLayout.js';
import {isPaperId, PAPERS} from './print/papers.js';
import {printedSheetCount} from './print/tiling.js';
import {perfLog} from './print/perfDebug.js';
import type {PrintMode, ShopSizeId} from './print/charucoDocUrl.js';
import {SHOP_SQUARE_MM_MAX} from './print/shopSizes.js';
import {shopSheetLayout, smallestFittingShopSize} from './print/shopLayout.js';
import {
    applyThemePreference,
    getStoredPreference,
    initTheme,
    setStoredPreference,
    type ThemePreference,
} from './ui/theme.js';
import {
    FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL,
    distanceLabel,
    distanceSelectLabel,
    interpolate,
    paperLabel,
    paperOptionDimensions,
    S,
    sheetCountPhrase,
} from './ui/strings.js';
import {
    applyAutoPreset,
    effectiveTiling,
    IMPERIAL,
    setGridSize,
    setSquareFollowingBand,
    shopLayoutNow,
    snapSquareForMode,
    squareSliderMaxMm,
    state,
} from './ui/appState.js';
import {byId, showErr} from './ui/dom.js';
import {syncPageStepper, wirePageStepper} from './ui/sheetsStepper.js';
import {mountPreviewScaleScene, schedulePreview} from './ui/preview.js';
import {openPrintDialog, savePdfFile, syncExportButtons} from './ui/printExport.js';
import {clearShopSizeHint, shopSummaryText, syncShopControls, wireShopControls} from './ui/shopControls.js';
import {
    applyQrQueryFromLocation,
    forgetLinkSquare,
    refitSquareToPaper,
    renderScanCard,
    scheduleAddressBarSync,
    syncQrVersionBanner,
} from './ui/chartLink.js';
import {initDevQrLinkTargetUi, syncDevQrLinkTargetUi} from './ui/devQrLinkTarget.js';

/** Shown under the mode toggle after a mode switch (refused, or the square shrank); cleared by the next change. */
let modeNotice: string | null = null;

function clearTransientNotices(): void {
    modeNotice = null;
    clearShopSizeHint();
}

/**
 * The board on a print-shop size: its own square if some size takes it, else the largest smaller square
 * in its distance band that one does. `null` if none does.
 */
function shopFitForBoard(): {squareMm: number; sizeId: ShopSizeId} | null {
    const bandMin = Math.min(workingDistanceMinSquareMm(state.distanceId), state.squareMm);
    for (let squareMm = Math.min(state.squareMm, SHOP_SQUARE_MM_MAX); squareMm >= bandMin; squareMm--) {
        const sizeId = smallestFittingShopSize(state.squaresX, state.squaresY, squareMm, state.shopUnit);
        if (sizeId) {
            return {squareMm, sizeId};
        }
    }
    return null;
}

/**
 * The print-shop board left for home paper, when the square had to shrink to print there. Switching back
 * with the board untouched restores its square and size.
 */
let shopBoardBeforeHome: {squaresX: number; squaresY: number; homeSquareMm: number; squareMm: number; sizeId: ShopSizeId} | null =
    null;

/**
 * Switches between "My printer" and "Print shop". X, Y and the distance never change without telling the
 * user: entering print-shop mode keeps the board on the smallest size that fits it, shrinks the square
 * within its band if it must (with a notice), or refuses (with a message). Leaving it keeps the square if
 * the home paper prints it, else the nearest that does (with a notice).
 */
function setMode(mode: PrintMode): void {
    if (mode === state.mode) {
        return;
    }
    clearTransientNotices();
    const back = shopBoardBeforeHome;
    shopBoardBeforeHome = null;
    if (
        mode === 'shop' &&
        !state.autoGrid &&
        back &&
        back.squaresX === state.squaresX &&
        back.squaresY === state.squaresY &&
        back.homeSquareMm === state.squareMm &&
        shopSheetLayout(state.squaresX, state.squaresY, back.squareMm, back.sizeId)
    ) {
        setSquareFollowingBand(back.squareMm);
        state.shopSizeId = back.sizeId;
    } else if (mode === 'shop' && !state.autoGrid) {
        const fit = shopFitForBoard();
        if (!fit) {
            modeNotice = S.shopModeNoFit;
            syncUi();
            return;
        }
        if (fit.squareMm !== state.squareMm) {
            modeNotice = interpolate(S.shopModeSnapped, {from: state.squareMm, to: fit.squareMm});
        }
        state.squareMm = fit.squareMm;
        state.shopSizeId = fit.sizeId;
    }
    const shopBoard = {squareMm: state.squareMm, sizeId: state.shopSizeId};
    state.mode = mode;
    if (mode === 'home' && !state.autoGrid) {
        // Print-shop squares may be larger than home paper allows; keep the nearest that prints.
        const snapped = snapSquareForMode(state.squareMm);
        if (snapped !== null && snapped !== shopBoard.squareMm) {
            modeNotice = interpolate(S.homeModeSnapped, {from: shopBoard.squareMm, to: snapped, paper: paperLabel(state.paperId)});
            if (shopBoard.sizeId) {
                shopBoardBeforeHome = {
                    squaresX: state.squaresX,
                    squaresY: state.squaresY,
                    homeSquareMm: snapped,
                    squareMm: shopBoard.squareMm,
                    sizeId: shopBoard.sizeId,
                };
            }
            setSquareFollowingBand(snapped);
        }
    }
    // An untouched preset follows the mode: home paper's, or the print-shop board's.
    applyAutoPreset();
    forgetLinkSquare();
    syncUi({previewDelayMs: 0});
}

/** The user took over the board: the distance preset no longer sets it, and a link's square is forgotten. */
function takeOverBoard(): void {
    state.autoGrid = false;
    forgetLinkSquare();
}

function syncThemeToggle(): void {
    const pref = getStoredPreference();
    for (const b of byId('themeToggle').querySelectorAll<HTMLButtonElement>('[data-theme-pick]')) {
        b.setAttribute('aria-pressed', String(b.dataset.themePick === pref));
    }
}

let syncUiRafId: number | null = null;
/** True while `#distance` native selection was cleared so re-picking the same option fires `change`; must not overwrite value in `syncUi`. */
let suppressDistanceSelectUiClamp = false;
/**
 * While true (range-slider drag or held sheets-stepper button), previews use the short debounce; the
 * window-level pointerup/pointercancel clears it and runs a full sync.
 */
let pointerGestureHeld = false;

type SyncUiOptions = {
    /**
     * When set, overrides automatic interactive vs idle debounce for the preview scheduling at the end of this sync.
     */
    previewDelayMs?: number;
};

/**
 * Batches slider-driven DOM updates into the next animation frame so the UI thread can paint spinners,
 * repaint the active range input, and run CSS animations instead of starving on hundreds of syncUi calls.
 */
function scheduleSyncUi(): void {
    if (syncUiRafId !== null) {
        return;
    }
    syncUiRafId = window.requestAnimationFrame(() => {
        syncUiRafId = null;
        syncUi();
    });
}

/** Ends a slider drag or a held stepper: one sync now (it drops any pending one) and the preview now. */
function finalizePointerGesture(): void {
    if (!pointerGestureHeld) {
        return;
    }
    pointerGestureHeld = false;
    syncUi({previewDelayMs: 0});
}

function setIntroElement(el: HTMLElement): void {
    const prefix = document.createTextNode(S.introMain + S.introDocsPrefix);
    const a = document.createElement('a');
    a.href = FREEMOCAP_CALIBRATION_DOCS_MULTI_CAM_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = S.introDocsLinkLabel;
    const suffix = document.createTextNode(S.introDocsSuffix);
    el.replaceChildren(prefix, a, suffix);
}

/** The printing advice for the mode; rebuilt only when the mode or (print shop) the crop-mark setting changes. */
function syncPrintAdvice(el: HTMLElement): void {
    const key = state.mode === 'shop' ? `shop|${state.shopCropMarks}` : 'home';
    if (el.dataset.key === key) {
        return;
    }
    el.dataset.key = key;
    if (state.mode === 'shop') {
        const finish = document.createElement('p');
        const lead = document.createElement('strong');
        lead.textContent = S.shopAdviceLead;
        finish.append(lead, document.createTextNode(S.shopAdviceFinish));
        const paragraphs: string[] = [S.shopAdviceSubstrate, S.shopAdviceProducts, S.shopAdviceTemplate];
        if (!state.shopCropMarks) {
            paragraphs.push(S.shopAdviceCropMarks);
        }
        el.replaceChildren(
            finish,
            ...paragraphs.map((text) => {
                const p = document.createElement('p');
                p.textContent = text;
                return p;
            }),
        );
        return;
    }
    const shop = document.createElement('p');
    const shopLead = document.createElement('strong');
    shopLead.textContent = S.printAdviceShopLead;
    shop.append(shopLead, document.createTextNode(S.printAdviceShop));
    const home = document.createElement('p');
    home.textContent = S.printAdviceHomeBody;
    const homeRule = document.createElement('p');
    const emphasis = document.createElement('strong');
    emphasis.textContent = S.printAdviceHomeEmphasis;
    homeRule.appendChild(emphasis);
    el.replaceChildren(shop, home, homeRule);
}

/** Advanced settings fold out on narrow screens only; on desktop they stay open (see style.css). */
function initAdvancedFoldout(): void {
    const advanced = document.getElementById('advancedSettings') as HTMLDetailsElement | null;
    if (!advanced) {
        return;
    }
    const desktop = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => {
        if (desktop.matches) {
            advanced.open = true;
        }
    };
    sync();
    desktop.addEventListener('change', sync);
    // Desktop has no toggle, so keep it from being closed by any route.
    advanced.addEventListener('toggle', sync);
}

/** Copy, option lists and slider bounds that never change in a session; set once in {@link boot}. */
function initStaticUi(): void {
    byId('pageTitle').textContent = S.title;
    setIntroElement(byId('intro'));
    byId('controls-heading').textContent = S.chartSettings;
    byId('lbl-mode').textContent = S.printWith;
    for (const btn of byId('modeToggle').querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        btn.textContent = btn.dataset.mode === 'shop' ? S.modeShop : S.modeHome;
    }
    byId('lbl-distance').textContent = S.workingDistance;
    byId('lbl-paper').textContent = S.paperSize;
    byId('lbl-banner').textContent = S.banner;
    byId('bannerCaption').textContent = S.bannerCaption;
    byId('lbl-shopSize').textContent = S.shopSize;
    byId('shopUnitToggle').setAttribute('aria-label', S.shopUnits);
    byId('lbl-advanced').textContent = S.advanced;
    byId('lbl-pages').textContent = S.sheetsOfPaper;
    byId('lbl-shopBleed').textContent = S.shopBleed;
    byId('lbl-shopCropMarks').textContent = S.shopCropMarks;
    byId('print-save-heading').textContent = S.printSave;
    byId('shopOrderTitle').textContent = S.shopOrderTitle;
    byId('btnCopyOrder').textContent = S.shopOrderCopy;
    byId('preview-title').textContent = S.previewTitle;
    byId('fullChartHint').textContent = S.fullChartHint;

    // Square-length band labels; syncUi sizes them to the slider's range.
    const tierEl = byId('tierLabels');
    tierEl.replaceChildren(
        ...(['close', 'near', 'far'] as const).map((id) => {
            const span = document.createElement('span');
            span.style.color = `var(--${id})`;
            span.textContent = distanceLabel(id, IMPERIAL);
            return span;
        }),
    );
    (tierEl.lastElementChild as HTMLElement).style.flex = '1';

    const sqmm = byId('sqmm') as HTMLInputElement;
    sqmm.min = String(CHARUCO_SQUARE_MM_MIN);
    sqmm.step = '1';
    for (const id of ['sx', 'sy']) {
        const slider = byId(id) as HTMLInputElement;
        slider.min = String(BOARD_GRID_MIN);
        slider.max = String(BOARD_GRID_MAX);
        slider.step = '1';
    }

    const distSel = byId('distance') as HTMLSelectElement;
    for (const {id} of WORKING_DISTANCES) {
        distSel.add(new Option(distanceSelectLabel(id, IMPERIAL), id));
    }
    const paperSel = byId('paper') as HTMLSelectElement;
    for (const p of PAPERS) {
        paperSel.add(new Option(interpolate(S.paperOption, {paper: paperLabel(p.id), dims: paperOptionDimensions(p)}), p.id));
    }

    const themeGroup = byId('themeToggle');
    themeGroup.setAttribute('aria-label', S.colorTheme);
    for (const b of themeGroup.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')) {
        const pick = b.dataset.themePick as ThemePreference;
        const label = pick === 'dark' ? S.themeDark : pick === 'light' ? S.themeLight : S.themeSystem;
        b.setAttribute('aria-label', label);
        b.setAttribute('title', label);
    }
    syncThemeToggle();
}

function syncUi(options: SyncUiOptions = {}): void {
    const {previewDelayMs} = options;
    const t0 = IS_DEV ? performance.now() : 0;
    if (syncUiRafId !== null) {
        window.cancelAnimationFrame(syncUiRafId);
        syncUiRafId = null;
    }
    const tiling = effectiveTiling();

    syncModeControls();
    byId('lbl-square').textContent = interpolate(S.squareLengthHeading, {mm: state.squareMm});
    byId('lbl-sx').textContent = interpolate(S.squaresInX, {n: state.squaresX});
    byId('lbl-sy').textContent = interpolate(S.squaresInY, {n: state.squaresY});
    syncPrintAdvice(byId('printAdvice'));

    // The band edges move with the slider's end, which print-shop mode raises.
    const frac = squareLengthTierBandEdgeFractions(squareSliderMaxMm());
    const pCloseEnd = frac.closeNear * 100;
    const pNearEnd = frac.nearFar * 100;
    const [closeLabel, nearLabel] = byId('tierLabels').children as HTMLCollectionOf<HTMLElement>;
    closeLabel.style.width = `${pCloseEnd}%`;
    nearLabel.style.width = `${Math.max(0, pNearEnd - pCloseEnd)}%`;
    const sliderStack = byId('squareMmSliderStack');
    sliderStack.style.setProperty('--tier-p-close-end', `${pCloseEnd}%`);
    sliderStack.style.setProperty('--tier-p-near-end', `${pNearEnd}%`);

    const sqmm = byId('sqmm') as HTMLInputElement;
    sqmm.max = String(squareSliderMaxMm());
    sqmm.value = String(state.squareMm);

    syncPageStepper(tiling);

    (byId('sx') as HTMLInputElement).value = String(state.squaresX);
    (byId('sy') as HTMLInputElement).value = String(state.squaresY);

    if (!suppressDistanceSelectUiClamp) {
        (byId('distance') as HTMLSelectElement).value = state.distanceId;
    }
    (byId('paper') as HTMLSelectElement).value = state.paperId;
    (byId('banner') as HTMLInputElement).checked = state.banner;

    byId('layoutSummary').textContent =
        state.mode === 'shop'
            ? shopSummaryText(shopLayoutNow())
            : !tiling
              ? S.layoutCannotFit
              : interpolate(tiling.pageCount > 1 ? S.layoutSummaryMulti : S.layoutSummary, {
                    sheets: sheetCountPhrase(printedSheetCount(tiling.pageCount)),
                    cols: tiling.npx,
                    rows: tiling.npy,
                    squaresX: state.squaresX,
                    squaresY: state.squaresY,
                    squareMm: state.squareMm,
                });

    syncExportButtons();
    showErr(null);
    if (IS_DEV) {
        const dt = performance.now() - t0;
        if (dt > 16) {
            perfLog('syncUi (before schedulePreview debounce)', dt);
        }
    }
    syncDevQrLinkTargetUi();
    schedulePreview(previewDelayMs, pointerGestureHeld);
    scheduleAddressBarSync();
}

/** Mode toggle, which board-size control shows, and the print-shop size, unit, bleed and crop-mark controls. */
function syncModeControls(): void {
    const shop = state.mode === 'shop';
    for (const btn of byId('modeToggle').querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
    }
    const notice = byId('modeNotice');
    notice.textContent = modeNotice ?? '';
    notice.classList.toggle('hidden', modeNotice === null);

    byId('paperField').classList.toggle('hidden', shop);
    byId('bannerField').classList.toggle('hidden', shop);
    byId('pagesGroup').classList.toggle('hidden', shop);
    for (const id of ['shopSizeField', 'shopBleedField', 'shopCropField', 'shopOrder']) {
        byId(id).classList.toggle('hidden', !shop);
    }
    if (shop) {
        syncShopControls();
    }
}

function wireUi(): void {
    window.addEventListener(
        'pointerdown',
        (e) => {
            if (e.target instanceof HTMLInputElement && e.target.type === 'range') {
                pointerGestureHeld = true;
            }
        },
        true,
    );
    window.addEventListener('pointerup', finalizePointerGesture, true);
    window.addEventListener('pointercancel', finalizePointerGesture, true);

    const distanceSel = byId('distance') as HTMLSelectElement;
    /** Native `<select>` does not fire `change` when re-picking the same option; briefly clear selection so it always fires. */
    let pendingDistanceRestore: string | null = null;
    /** After clearing, ignore further primary-button downs until closed (`change`) or cancelled (`blur`). */
    let distanceArmClearForNextPrimaryDown = true;

    distanceSel.addEventListener('mousedown', (e) => {
        if (e.button !== 0) {
            return;
        }
        if (!distanceArmClearForNextPrimaryDown) {
            return;
        }
        distanceArmClearForNextPrimaryDown = false;
        pendingDistanceRestore = distanceSel.value;
        suppressDistanceSelectUiClamp = true;
        distanceSel.selectedIndex = -1;
    });

    distanceSel.addEventListener('change', (e) => {
        pendingDistanceRestore = null;
        suppressDistanceSelectUiClamp = false;
        distanceArmClearForNextPrimaryDown = true;
        const distanceId = (e.target as HTMLSelectElement).value;
        if (isWorkingDistanceId(distanceId)) {
            state.distanceId = distanceId;
        }
        state.autoGrid = true;
        applyAutoPreset();
        clearTransientNotices();
        forgetLinkSquare();
        syncUi();
    });

    distanceSel.addEventListener('blur', () => {
        distanceArmClearForNextPrimaryDown = true;
        suppressDistanceSelectUiClamp = false;
        if (pendingDistanceRestore !== null && distanceSel.selectedIndex < 0) {
            const restore = pendingDistanceRestore;
            pendingDistanceRestore = null;
            distanceSel.value = restore;
        } else {
            pendingDistanceRestore = null;
        }
    });

    // A paper or banner change re-applies an untouched preset; otherwise the board keeps all but its square.
    const refitToSheets = (): void => {
        if (!state.autoGrid) {
            refitSquareToPaper();
        } else {
            applyAutoPreset();
        }
        syncUi();
    };
    (byId('paper') as HTMLSelectElement).addEventListener('change', (e) => {
        const paperId = (e.target as HTMLSelectElement).value;
        if (isPaperId(paperId)) {
            state.paperId = paperId;
        }
        refitToSheets();
    });
    (byId('banner') as HTMLInputElement).addEventListener('change', (e) => {
        state.banner = (e.target as HTMLInputElement).checked;
        refitToSheets();
    });

    const sqmmEl = byId('sqmm') as HTMLInputElement;
    sqmmEl.addEventListener('input', (e) => {
        takeOverBoard();
        clearTransientNotices();
        const raw = Number((e.target as HTMLInputElement).value);
        const snapped = snapSquareForMode(raw);
        if (snapped !== null) {
            setSquareFollowingBand(snapped);
        }
        scheduleSyncUi();
    });

    wirePageStepper({
        takeOverBoard,
        scheduleSyncUi,
        holdRepeating: () => {
            // Keeps the preview on the short interactive debounce while repeating (cleared on window pointerup).
            pointerGestureHeld = true;
        },
    });

    const sxEl = byId('sx') as HTMLInputElement;
    sxEl.addEventListener('input', (e) => {
        takeOverBoard();
        clearTransientNotices();
        setGridSize('squaresX', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    const syEl = byId('sy') as HTMLInputElement;
    syEl.addEventListener('input', (e) => {
        takeOverBoard();
        clearTransientNotices();
        setGridSize('squaresY', Number((e.target as HTMLInputElement).value));
        scheduleSyncUi();
    });

    for (const btn of byId('modeToggle').querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode === 'shop' ? 'shop' : 'home'));
    }
    wireShopControls({takeOverBoard, clearTransientNotices, syncUi});

    byId('btnPdf').addEventListener('click', () => void openPrintDialog());
    byId('btnSavePdf').addEventListener('click', () => void savePdfFile());

    const themeGroup = byId('themeToggle');
    for (const btn of themeGroup.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')) {
        btn.addEventListener('click', () => {
            setStoredPreference(btn.dataset.themePick as ThemePreference);
            applyThemePreference(getStoredPreference());
            syncThemeToggle();
        });
    }
}

function boot(): void {
    (byId('brandLogo') as HTMLImageElement).src = freemocapLogoUrl;
    initTheme();
    initStaticUi();
    mountPreviewScaleScene();
    wireUi();
    initAdvancedFoldout();
    // A literal in release builds, so the dev-only UI is left out of the bundle.
    if (IS_DEV) {
        initDevQrLinkTargetUi(() => syncUi({previewDelayMs: 0}));
    }
    // The default board; a chart link then replaces it (taking the board over) where it gives one.
    applyAutoPreset();
    applyQrQueryFromLocation();
    syncQrVersionBanner();
    syncUi();
    renderScanCard(setMode);
}

boot();
