/**
 * The user's region from the browser's time zone and locale: the default paper, the print-shop unit and
 * feet vs metres in the UI copy.
 */
import type {PaperId} from '../print/papers.js';

const LETTER_DEFAULT_REGIONS = new Set([
    'US', 'CA', 'MX', 'PH', 'BZ', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'DO', 'PR', 'VI', 'CO', 'VE',
    'EC', 'CL',
]);

function regionFromLocaleTag(tag: string | undefined): string | undefined {
    if (!tag?.trim()) {
        return undefined;
    }
    try {
        const region = new Intl.Locale(tag).region;
        return region ? region.toUpperCase() : undefined;
    } catch {
        return undefined;
    }
}

const CANADA_TIMEZONES = new Set([
    'America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay',
    'America/Blanc-Sablon', 'America/Toronto', 'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit',
    'America/Pangnirtung', 'America/Atikokan', 'America/Winnipeg', 'America/Regina', 'America/Swift_Current',
    'America/Edmonton', 'America/Cambridge_Bay', 'America/Yellowknife', 'America/Inuvik', 'America/Creston',
    'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Vancouver', 'America/Whitehorse', 'America/Dawson',
    'America/Rankin_Inlet', 'America/Resolute', 'America/Rainy_River', 'Canada/Atlantic', 'Canada/Central',
    'Canada/Eastern', 'Canada/Mountain', 'Canada/Newfoundland', 'Canada/Pacific', 'Canada/Saskatchewan',
    'Canada/Yukon',
]);

/** Primary US IANA zones — default paper when time zone matches (see {@link defaultPaperId}). */
const US_PRIMARY_TIMEZONES = new Set([
    'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
    'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo',
    'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Indiana/Tell_City', 'America/Indiana/Knox',
    'America/Chicago', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem',
    'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
    'America/Adak', 'Pacific/Honolulu', 'Pacific/Guam', 'Pacific/Saipan', 'America/Puerto_Rico', 'America/St_Thomas',
]);

const MEXICO_PRIMARY_TIMEZONES = new Set([
    'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Matamoros', 'America/Monterrey',
    'America/Mazatlan', 'America/Chihuahua', 'America/Hermosillo', 'America/Tijuana', 'America/Bahia_Banderas',
    'America/Ojinaga',
]);

/**
 * Region of a known IANA time zone. The three countries stay apart: they share Letter paper, but the
 * print-shop unit differs (`shopUnitForRegion`: inches in the US and Canada, mm in Mexico).
 */
function regionFromTimeZone(): string | undefined {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!tz) {
            return undefined;
        }
        if (CANADA_TIMEZONES.has(tz)) {
            return 'CA';
        }
        if (US_PRIMARY_TIMEZONES.has(tz)) {
            return 'US';
        }
        if (MEXICO_PRIMARY_TIMEZONES.has(tz)) {
            return 'MX';
        }
    } catch {
        /* ignore */
    }
    return undefined;
}

function localeTags(): string[] {
    const candidates: string[] = [];
    try {
        candidates.push(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch {
        /* ignore */
    }
    if (typeof navigator !== 'undefined') {
        candidates.push(navigator.language);
        if (navigator.languages?.length) {
            candidates.push(...navigator.languages);
        }
    }
    return candidates;
}

function firstRegionFromLocaleTags(): string | undefined {
    for (const c of localeTags()) {
        const r = regionFromLocaleTag(c);
        if (r) {
            return r;
        }
    }
    return undefined;
}

/** Letter in the Americas' Letter regions, else A4. */
export function defaultPaperIdForRegion(region: string | undefined): PaperId {
    const r = region?.trim().toUpperCase();
    if (r && LETTER_DEFAULT_REGIONS.has(r)) {
        return 'letter';
    }
    return 'a4';
}

/**
 * The user's region: known IANA time zone → region (CA / US / MX allowlists), else the first BCP-47 region
 * from locale / `navigator`, else `undefined`.
 */
export function defaultRegion(): string | undefined {
    return regionFromTimeZone() ?? firstRegionFromLocaleTags();
}

/** Default paper for {@link defaultRegion}, else A4. */
export function defaultPaperId(): PaperId {
    return defaultPaperIdForRegion(defaultRegion());
}

/** Feet vs metres (and inches vs cm) in the UI copy: US English → imperial; first other explicit region → metric. */
export function prefersImperialUnits(): boolean {
    for (const c of localeTags()) {
        const r = regionFromLocaleTag(c);
        if (r === 'US') {
            return true;
        }
        if (r) {
            return false;
        }
    }
    return false;
}
