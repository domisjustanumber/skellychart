/**
 * The home printer's papers. No imports: Node scripts load this before the modules that tile on it.
 *
 * `linkCode` is the digit in the chart link's packed `p` field. Fixed forever: printed charts carry
 * these codes, so never renumber or reuse one; append new papers with new digits (`npm run check:presets`
 * checks they stay unique single digits). `units` is what the paper is sold in: the printed page size
 * and the paper dropdown use it.
 */
export const PAPERS = [
    {id: 'a4', wMm: 210, hMm: 297, linkCode: 0, units: 'mm'},
    {id: 'a3', wMm: 297, hMm: 420, linkCode: 1, units: 'mm'},
    {id: 'letter', wMm: 215.9, hMm: 279.4, linkCode: 2, units: 'in'},
    {id: 'tabloid', wMm: 279.4, hMm: 431.8, linkCode: 3, units: 'in'},
] as const;

export type Paper = (typeof PAPERS)[number];
export type PaperId = Paper['id'];
export type PaperUnits = Paper['units'];

export function isPaperId(id: string): id is PaperId {
    return PAPERS.some((p) => p.id === id);
}

export function paperById(id: PaperId): Paper {
    return PAPERS.find((p) => p.id === id)!;
}
