/**
 * Scale preview: the chart drawn to scale over two people, a typically taller and a typically shorter
 * one, each with a height ruler in cm and inches. The scene is laid out in mm (floor at y = 0, up is
 * negative y) and fitted to the container, so everything in it shares one scale. Rulers and text are
 * sized in screen px so they stay legible however large the chart is.
 */
import {MM_PER_INCH} from '../print/svgUtils.js';
import figureUrl from './scaleFigure.svg';
import {chartSizeVars, interpolate, S} from './strings.js';

/** A chart drawn in the scene: an SVG image shown `widthMm`×`heightMm`. */
export interface ScaleSceneChart {
    /** The image's SVG markup. */
    svg: string;
    widthMm: number;
    heightMm: number;
    /** True when the image is a whole printed sheet (paper included) rather than the board alone. */
    isSheet: boolean;
}

/**
 * The chart as drawn: its SVG as a blob URL, made once per chart, so a redraw on resize only puts a short
 * link in the markup (a multi-sheet chart's SVG can be many MB).
 */
type DrawnChart = Omit<ScaleSceneChart, 'svg'> & {href: string};

/**
 * The taller person on the left, the shorter on the right: 6 ft and 5 ft exactly, so both rulers read
 * round figures in either unit.
 */
const PEOPLE = [
    {heightMm: 1828.8, side: -1},
    {heightMm: 1524, side: 1},
] as const;

/**
 * Frame of the person drawing (`scaleFigure.svg`, viewBox 400×1000), as a fraction of their height: the
 * image spans ±FIGURE_FRAME_HALF_W across, with the soles at the floor and the top of the head at their
 * height.
 */
const FIGURE_FRAME_HALF_W = 0.2;
/** Half the person's width (fraction of height), hands included: the SVG reaches x 33–367 of 400. */
const FIGURE_HALF_W = 0.17;
/** Gap between the two people (mm). */
const PEOPLE_GAP_MM = 200;
/** Height of the chart's centre when held (mm); a chart too tall for that stands on the floor. */
const CHART_CENTRE_MM = 1150;

const MAX_H_PX = 300;
const FONT_PX = 11;
const LINE_PX = 13;
const RULER_GAP_PX = 8;
const TICK_MINOR_PX = 3;
const TICK_MAJOR_PX = 6;
/** Closest two ticks may sit (px) before that tick level is left out. */
const TICK_MIN_SPACING_PX = 3;
const MARGIN_SIDE_PX = 46;
const MARGIN_TOP_PX = 2 * LINE_PX + 8;
const MARGIN_BOTTOM_PX = 6;
/** White border (px) round a multi-sheet chart, so its black edge squares stand off a dark scene. */
const CHART_RIM_PX = 3;

function n(v: number): string {
    return String(+v.toFixed(2));
}

/** Soft floor shadow under each person. */
const SCENE_DEFS =
    `<defs>` +
    `<radialGradient id="ss-shadow">` +
    `<stop offset="0" class="ss-shadow"/><stop offset="1" class="ss-shadow" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>`;

function formatHeightMetric(mm: number): string {
    return interpolate(S.heightCm, {cm: Math.round(mm / 10)});
}

function formatHeightImperial(mm: number): string {
    const inches = Math.round(mm / MM_PER_INCH);
    return interpolate(S.heightFtIn, {ft: Math.floor(inches / 12), in: inches % 12});
}

/** A height in cm and in feet and inches, the reader's own unit first. */
function heightLabels(mm: number, imperialFirst: boolean): [string, string] {
    const metric = formatHeightMetric(mm);
    const imperial = formatHeightImperial(mm);
    return imperialFirst ? [imperial, metric] : [metric, imperial];
}

/**
 * Ticks along a ruler at `x` from the floor to `heightMm`: cm on the left, inches on the right, with
 * a longer tick every 50 cm and every foot. A tick level is dropped when its ticks would crowd together.
 */
function rulerTicks(x: number, heightMm: number, scale: number): string {
    const out: string[] = [];
    const level = (stepMm: number, majorEvery: number, dir: -1 | 1): void => {
        const showMinor = stepMm * scale >= TICK_MIN_SPACING_PX;
        if (stepMm * majorEvery * scale < TICK_MIN_SPACING_PX) {
            return;
        }
        for (let i = 1; i * stepMm < heightMm - 1e-6; i++) {
            const major = i % majorEvery === 0;
            if (!major && !showMinor) {
                continue;
            }
            const len = (major ? TICK_MAJOR_PX : TICK_MINOR_PX) / scale;
            out.push(`M${n(x)} ${n(-i * stepMm)}h${n(dir * len)}`);
        }
    };
    level(100, 5, -1);
    level(6 * MM_PER_INCH, 2, 1);
    return out.join('');
}

/** Scene markup for a container `availW` px wide, at most `maxH` px tall. */
function sceneMarkup(availW: number, maxH: number, chart: DrawnChart | null, imperialFirst: boolean): string {
    const people = PEOPLE.map(({heightMm, side}) => {
        const halfW = FIGURE_HALF_W * heightMm;
        return {heightMm, side, halfW, cx: side * (PEOPLE_GAP_MM / 2 + halfW)};
    });
    const chartBox = chart
        ? {
              x: -chart.widthMm / 2,
              y: -(Math.max(0, CHART_CENTRE_MM - chart.heightMm / 2) + chart.heightMm),
              w: chart.widthMm,
              h: chart.heightMm,
              href: chart.href,
              isSheet: chart.isSheet,
          }
        : null;

    // Scene extent (mm) before the px margins for rulers and labels.
    let left = Math.min(...people.map((p) => p.cx - p.halfW));
    let right = Math.max(...people.map((p) => p.cx + p.halfW));
    let top = -Math.max(...people.map((p) => p.heightMm));
    if (chartBox) {
        left = Math.min(left, chartBox.x);
        right = Math.max(right, chartBox.x + chartBox.w);
        top = Math.min(top, chartBox.y);
    }
    const contentW = right - left;
    const contentH = -top;
    const scale = Math.max(
        1e-6,
        Math.min((availW - 2 * MARGIN_SIDE_PX) / contentW, (maxH - MARGIN_TOP_PX - MARGIN_BOTTOM_PX) / contentH),
    );
    const px = (v: number): number => v / scale;
    const vbX = left - px(MARGIN_SIDE_PX);
    const vbY = top - px(MARGIN_TOP_PX);
    const vbW = contentW + px(2 * MARGIN_SIDE_PX);
    const vbH = contentH + px(MARGIN_TOP_PX + MARGIN_BOTTOM_PX);
    const peopleMarkup = people
        .map((p) => {
            const h = p.heightMm;
            return (
                `<image href="${figureUrl}" x="${n(p.cx - FIGURE_FRAME_HALF_W * h)}" y="${n(-h)}" ` +
                `width="${n(2 * FIGURE_FRAME_HALF_W * h)}" height="${n(h)}" preserveAspectRatio="none"/>`
            );
        })
        .join('');

    const parts: string[] = [SCENE_DEFS];
    parts.push(
        `<line class="ss-floor" x1="${n(vbX)}" x2="${n(vbX + vbW)}" y1="0" y2="0" vector-effect="non-scaling-stroke"/>`,
        ...people.map((p) => {
            const rx = p.halfW + px(4);
            return `<ellipse cx="${n(p.cx)}" cy="0" rx="${n(rx)}" ry="${n(rx * 0.12)}" fill="url(#ss-shadow)"/>`;
        }),
        peopleMarkup,
    );
    if (chartBox) {
        // A multi-sheet chart (the board alone) sits on a thin white rim; a sheet has its own paper margin.
        // A chart standing on the floor keeps its rim and shadow above the floor line.
        const rim = chartBox.isSheet ? 0 : px(CHART_RIM_PX);
        const onFloor = chartBox.y + chartBox.h >= -1e-6;
        const back = {
            x: chartBox.x - rim,
            y: chartBox.y - rim,
            w: chartBox.w + 2 * rim,
            h: chartBox.h + (onFloor ? rim : 2 * rim),
        };
        const shadowDrop = onFloor ? 0 : px(1.5);
        parts.push(
            `<rect class="ss-chart-shadow" x="${n(back.x + px(1))}" y="${n(back.y + shadowDrop)}" width="${n(back.w)}" height="${n(back.h)}"/>`,
            `<rect class="ss-chart-back" x="${n(back.x)}" y="${n(back.y)}" width="${n(back.w)}" height="${n(back.h)}"/>`,
            `<image class="ss-chart" href="${chartBox.href}" x="${n(chartBox.x)}" y="${n(chartBox.y)}" width="${n(chartBox.w)}" height="${n(chartBox.h)}" preserveAspectRatio="none"/>`,
            `<rect class="ss-chart-edge" x="${n(back.x)}" y="${n(back.y)}" width="${n(back.w)}" height="${n(back.h)}" vector-effect="non-scaling-stroke"/>`,
        );
    }
    // Rulers and labels go over the chart, so a chart that hides a person still shows their height.
    for (const p of people) {
        const x = p.cx + p.side * (p.halfW + px(RULER_GAP_PX + TICK_MAJOR_PX));
        const headX = p.cx;
        const y = -p.heightMm;
        const ruler =
            `M${n(x)} 0V${n(y)}` +
            `M${n(x - px(TICK_MAJOR_PX))} ${n(y)}h${n(px(2 * TICK_MAJOR_PX))}` +
            rulerTicks(x, p.heightMm, scale);
        parts.push(
            `<path class="ss-ruler-halo" d="${ruler}" vector-effect="non-scaling-stroke"/>`,
            `<path class="ss-ruler" d="${ruler}" vector-effect="non-scaling-stroke"/>`,
            `<line class="ss-head-line" x1="${n(x)}" x2="${n(headX)}" y1="${n(y)}" y2="${n(y)}" vector-effect="non-scaling-stroke"/>`,
        );
        const [first, second] = heightLabels(p.heightMm, imperialFirst);
        const textY = y - px(LINE_PX + 4);
        parts.push(
            `<text class="ss-label" x="${n(x)}" y="${n(textY)}" font-size="${n(px(FONT_PX))}" stroke-width="${n(px(3))}" text-anchor="middle">` +
                `<tspan x="${n(x)}" font-weight="600">${first}</tspan>` +
                `<tspan x="${n(x)}" dy="${n(px(LINE_PX))}">${second}</tspan>` +
                `</text>`,
        );
    }

    const wPx = contentW * scale + 2 * MARGIN_SIDE_PX;
    const hPx = contentH * scale + MARGIN_TOP_PX + MARGIN_BOTTOM_PX;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" ` +
        `width="${Math.floor(wPx)}" height="${Math.floor(hPx)}" role="img" aria-label="${sceneAriaLabel(chart, imperialFirst)}">` +
        parts.join('') +
        `</svg>`
    );
}

function sceneAriaLabel(chart: DrawnChart | null, imperialFirst: boolean): string {
    const both = (mm: number): string => {
        const [first, second] = heightLabels(mm, imperialFirst);
        return `${first} (${second})`;
    };
    const people = {tall: both(PEOPLE[0].heightMm), short: both(PEOPLE[1].heightMm)};
    if (!chart) {
        return interpolate(S.scaleSceneAriaNoChart, people);
    }
    const size = chartSizeVars(chart.widthMm, chart.heightMm, imperialFirst);
    return interpolate(chart.isSheet ? S.scaleSceneAriaSheet : S.scaleSceneAria, {...people, ...size});
}

/**
 * Draws the scale scene into `root` and redraws it when `root` resizes. Call `update` with the chart to
 * show, or `null` for the people alone.
 */
export function mountScaleScene(root: HTMLElement, imperialFirst: boolean): {update(chart: ScaleSceneChart | null): void} {
    let current: DrawnChart | null = null;
    let lastW = -1;
    let lastWindowH = -1;
    const draw = (): void => {
        const w = root.clientWidth;
        if (w <= 0) {
            return;
        }
        lastW = w;
        lastWindowH = window.innerHeight;
        root.innerHTML = sceneMarkup(w, Math.min(MAX_H_PX, lastWindowH * 0.45), current, imperialFirst);
    };
    // The scene's height cap follows the window height, so redraw on either change.
    const redrawIfResized = (): void => {
        if (root.clientWidth !== lastW || window.innerHeight !== lastWindowH) {
            draw();
        }
    };
    new ResizeObserver(redrawIfResized).observe(root);
    window.addEventListener('resize', redrawIfResized);
    draw();
    return {
        update(chart) {
            // The scene owns each blob URL; the old image is replaced by the draw straight after.
            if (current) {
                URL.revokeObjectURL(current.href);
            }
            if (chart) {
                const {svg, ...size} = chart;
                current = {...size, href: URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}))};
            } else {
                current = null;
            }
            draw();
        },
    };
}
