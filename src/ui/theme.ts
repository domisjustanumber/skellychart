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
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (getStoredPreference() === 'system') {
            applyThemePreference('system');
        }
    });
}
