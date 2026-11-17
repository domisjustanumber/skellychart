export type ThemePreference = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'skellychart-theme';

export function getStoredPreference(): ThemePreference {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') {
        return v;
    }
    return 'system';
}

export function setStoredPreference(p: ThemePreference): void {
    localStorage.setItem(STORAGE_KEY, p);
}

export function resolveTheme(p: ThemePreference): 'dark' | 'light' {
    if (p === 'dark') {
        return 'dark';
    }
    if (p === 'light') {
        return 'light';
    }
    // Dark unless the OS asks for light: dark is the designed theme, and the fallback when the OS expresses none.
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyThemePreference(pref: ThemePreference): void {
    document.documentElement.dataset.theme = resolveTheme(pref);
    document.documentElement.dataset.themePreference = pref;
}

let systemListenerAttached = false;

export function initTheme(): void {
    applyThemePreference(getStoredPreference());
    if (systemListenerAttached) {
        return;
    }
    systemListenerAttached = true;
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (getStoredPreference() === 'system') {
            applyThemePreference('system');
        }
    });
}
