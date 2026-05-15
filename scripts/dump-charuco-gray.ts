/**
 * Write raw uint8 grayscale raster (row-major, len = width × height) for OpenCV comparison.
 * Usage: npx tsx scripts/dump-charuco-gray.ts --out /tmp/ts.gray --width 640 --height 480 --sx 5 --sy 3 --square-mm 54 --marker-ratio 0.8
 */
import {writeFileSync} from 'node:fs';
import {renderCharucoBoardGray} from '../src/charuco/board.js';

function usage(): never {
    console.error(
        'Usage: dump-charuco-gray.ts --out <path> --width W --height H --sx X --sy Y --square-mm S --marker-ratio R',
    );
    process.exit(1);
}

function parseArgs(): {
    out: string;
    width: number;
    height: number;
    sx: number;
    sy: number;
    squareMm: number;
    markerRatio: number;
} {
    const a = process.argv.slice(2);
    const get = (flag: string): string | undefined => {
        const i = a.indexOf(flag);
        if (i < 0) {
            return undefined;
        }
        return a[i + 1];
    };
    const out = get('--out');
    const width = Number(get('--width'));
    const height = Number(get('--height'));
    const sx = Number(get('--sx'));
    const sy = Number(get('--sy'));
    const squareMm = Number(get('--square-mm'));
    const markerRatio = Number(get('--marker-ratio'));
    if (!out || [width, height, sx, sy, squareMm, markerRatio].some((x) => !Number.isFinite(x))) {
        usage();
    }
    if (sx < 1 || sy < 1 || width < 1 || height < 1) {
        usage();
    }
    return {out, width, height, sx, sy, squareMm, markerRatio};
}

const p = parseArgs();
const gray = renderCharucoBoardGray(p.width, p.height, {
    squaresX: p.sx,
    squaresY: p.sy,
    squareLength: p.squareMm,
    markerLength: p.squareMm * p.markerRatio,
});
writeFileSync(p.out, gray);
