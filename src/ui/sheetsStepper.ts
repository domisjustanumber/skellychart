/**
 * The sheets stepper: fewer / more buttons that step the square length between the page counts the grid
 * prints at the working distance, with hold-to-repeat and the arrow, Home and End keys.
 */
import {
    pageStepNeighbours,
    steppablePageCounts,
    type PageStep,
    workingDistanceMinSquareMm,
} from '../print/charucoLayout.js';
import {gridFeasibility} from '../print/feasibilityRules.js';
import {printedSheetCount} from '../print/tiling.js';
import {chartPageCount, effectiveTiling, IMPERIAL, paperDims, state} from './appState.js';
import {byId} from './dom.js';
import {chartSizeVars, distanceLabel, interpolate, S, sheetsShort} from './strings.js';

/** What a step does to the rest of the page; given to {@link wirePageStepper}. */
export interface PageStepperHooks {
    /** The user took over the board; called before a step changes it. */
    takeOverBoard(): void;
    scheduleSyncUi(): void;
    /** Called on each repeat while a button is held. */
    holdRepeating(): void;
}

/**
 * Stops of the sheets stepper for the current grid, paper, banner setting and working distance: they
 * end-stop at the distance's minimum square length and never change the distance.
 */
function pageSteps(): PageStep[] {
    const pd = paperDims();
    const minMm = workingDistanceMinSquareMm(state.distanceId);
    return steppablePageCounts(state.squaresX, state.squaresY, pd.wMm, pd.hMm, minMm, state.banner);
}

type PageStepTarget = 'fewer' | 'more' | 'fewest' | 'most';

/**
 * Moves the sheets stepper: sets the square length to the largest that prints the chosen page count.
 * Like the X / Y sliders it never changes the distance (the square slider is the only board control that
 * does); it end-stops at the distance minimum. Returns false when there is nowhere to go.
 */
function stepPages(which: PageStepTarget, hooks: PageStepperHooks): boolean {
    const current = chartPageCount(effectiveTiling());
    const target = pageStepNeighbours(pageSteps(), current)[which];
    if (!target || target.pages === current) {
        return false;
    }
    hooks.takeOverBoard();
    state.squareMm = target.squareMm;
    hooks.scheduleSyncUi();
    return true;
}

/** A sheets stepper button: how many sheets the step adds or removes, and the square length it gives. */
function renderPageStepButton(
    btn: HTMLElement,
    step: PageStep | null,
    currentPages: number,
    sign: string,
    noneLabel: string,
    ariaTemplate: string,
): void {
    const main = btn.querySelector('.page-step-main')!;
    const sub = btn.querySelector('.page-step-sub')!;
    // aria-disabled (not disabled) keeps keyboard focus on the button when it reaches an end stop.
    btn.setAttribute('aria-disabled', String(step === null));
    if (step) {
        const total = printedSheetCount(step.pages);
        const change = sheetsShort(Math.abs(total - printedSheetCount(currentPages)));
        main.textContent = `${sign} ${change}`;
        sub.textContent = interpolate(S.pagesStepSquares, {mm: step.squareMm});
        btn.setAttribute(
            'aria-label',
            interpolate(ariaTemplate, {change, total: sheetsShort(total), mm: step.squareMm}),
        );
    } else {
        main.textContent = `${sign} ${noneLabel}`;
        sub.textContent = '';
        btn.setAttribute('aria-label', noneLabel);
    }
}

/** Sheets stepper: the printed page count, the stops either side, and why it stops at an end. */
export function syncPageStepper(tiling: ReturnType<typeof effectiveTiling>): void {
    const count = chartPageCount(tiling);
    const printed = printedSheetCount(count);
    const {fewer, more} = tiling ? pageStepNeighbours(pageSteps(), count) : {fewer: null, more: null};
    byId('pagesValue').textContent = tiling ? sheetsShort(printed) : '—';
    const size = chartSizeVars(state.squaresX * state.squareMm, state.squaresY * state.squareMm, IMPERIAL);
    byId('pagesDetail').textContent = !tiling
        ? ''
        : tiling.pageCount > 1
          ? interpolate(S.pagesDetail, {cols: tiling.npx, rows: tiling.npy, ...size})
          : interpolate(S.pagesDetailOne, size);
    renderPageStepButton(byId('pagesFewer'), fewer, count, '−', S.pagesFewerNone, S.pagesFewerAria);
    renderPageStepButton(byId('pagesMore'), more, count, '+', S.pagesMoreNone, S.pagesMoreAria);

    let hint = '';
    if (tiling && !fewer && count > 1) {
        const pd = paperDims();
        const fewestAnyDistance = gridFeasibility(state.squaresX, state.squaresY, pd.wMm, pd.hMm, state.banner).steps[0]?.pages;
        hint =
            fewestAnyDistance !== undefined && fewestAnyDistance < count
                ? interpolate(S.pagesFewestHint, {
                      distance: distanceLabel(state.distanceId, IMPERIAL),
                      mm: workingDistanceMinSquareMm(state.distanceId),
                  })
                : interpolate(S.pagesFewestGridHint, {sheets: sheetsShort(printed)});
    } else if (tiling && !more) {
        // The last stop is always one square per sheet (checked by scripts/check-presets.ts).
        hint = S.pagesMostOnePerSheetHint;
    }
    const hintEl = byId('pagesHint');
    hintEl.textContent = hint;
    hintEl.classList.toggle('hidden', hint === '');
}

/** Click steps once; holding repeats (after 400 ms, every 120 ms) until an end stop. */
function wirePageStepButton(btn: HTMLElement, which: 'fewer' | 'more', hooks: PageStepperHooks): void {
    const readout = byId('pagesValue');
    let delayTimer: number | undefined;
    let repeatTimer: number | undefined;
    let repeated = false;
    const stop = (): void => {
        window.clearTimeout(delayTimer);
        window.clearInterval(repeatTimer);
        delayTimer = undefined;
        repeatTimer = undefined;
        if (readout.getAttribute('aria-live') === 'off') {
            // Announce only where the hold ended, not every step on the way.
            readout.setAttribute('aria-live', 'polite');
            const text = readout.textContent;
            readout.textContent = '';
            requestAnimationFrame(() => {
                readout.textContent = text;
            });
        }
    };
    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) {
            return;
        }
        stop();
        repeated = false;
        btn.setPointerCapture(e.pointerId);
        delayTimer = window.setTimeout(() => {
            readout.setAttribute('aria-live', 'off');
            repeatTimer = window.setInterval(() => {
                repeated = true;
                hooks.holdRepeating();
                if (!stepPages(which, hooks)) {
                    stop();
                }
            }, 120);
        }, 400);
    });
    btn.addEventListener('pointerup', stop);
    // Not lostpointercapture: a normal release fires it before its click, which must still be swallowed.
    for (const type of ['pointercancel', 'blur']) {
        btn.addEventListener(type, () => {
            stop();
            // No click follows a cancelled hold, so nothing is left to swallow.
            repeated = false;
        });
    }
    // A long press must repeat, not open the context menu or start a text selection.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
        // The click that ends a hold must not step again; keyboard clicks (detail 0) always step.
        if (repeated && e.detail !== 0) {
            repeated = false;
            return;
        }
        repeated = false;
        stepPages(which, hooks);
    });
}

/** Wires both buttons and the group's keys; called once in boot. */
export function wirePageStepper(hooks: PageStepperHooks): void {
    wirePageStepButton(byId('pagesFewer'), 'fewer', hooks);
    wirePageStepButton(byId('pagesMore'), 'more', hooks);
    const pageStepKeys: Record<string, PageStepTarget> = {
        ArrowLeft: 'fewer',
        ArrowDown: 'fewer',
        ArrowRight: 'more',
        ArrowUp: 'more',
        Home: 'fewest',
        End: 'most',
    };
    byId('pagesGroup').addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        const which = pageStepKeys[e.key];
        if (which) {
            e.preventDefault();
            stepPages(which, hooks);
        }
    });
}
