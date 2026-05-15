import {zipSync} from 'fflate';

export function zipSvgPages(pages: string[]): Blob {
    const files: Record<string, Uint8Array> = {};
    pages.forEach((svg, i) => {
        const name = `page-${String(i + 1).padStart(2, '0')}.svg`;
        files[name] = new TextEncoder().encode(svg);
    });
    const zipped = zipSync(files);
    return new Blob([new Uint8Array(zipped)], {type: 'application/zip'});
}
