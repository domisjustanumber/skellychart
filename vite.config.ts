import {readFileSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {defineConfig} from 'vite';

import {DEV_APP_VERSION} from './src/appVersion.ts';
import {APP_VERSION_RE} from './src/print/chartVersion.ts';

// Vite bundles this config to a temp file, so resolve from the project cwd (npm scripts run there).
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
};
// `prebuild` runs check:version too, but a bare `vite build` does not.
if (!APP_VERSION_RE.test(pkg.version)) {
    throw new Error(`package.json "version" must be x.y.z or x.y.z-prerelease, got ${String(pkg.version)}`);
}

/**
 * - `npm run dev`: the literal {@link DEV_APP_VERSION}, so a dev-printed QR is never mistaken
 *   for a release.
 * - `npm run build` / CI: the exact package.json version.
 */
function resolveAppVersion(command: 'build' | 'serve'): string {
    return command === 'serve' ? DEV_APP_VERSION : pkg.version;
}

/**
 * LAN IPv4 this machine's dev server is reachable at from a phone. Injected into the client so
 * the dev-only “local” QR target encodes a scannable URL even when the page was opened through
 * `localhost`. `VITE_DEV_LAN_HOST` overrides auto-detection when it picks a VPN/virtual adapter.
 */
function resolveDevLanIpv4(): string | null {
    const override = process.env.VITE_DEV_LAN_HOST?.trim();
    if (override) {
        return override;
    }
    const candidates: string[] = [];
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
        if (/vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|Loopback/i.test(name)) {
            continue;
        }
        for (const addr of addrs ?? []) {
            // Skip link-local (169.254/16) and loopback; prefer normal private LAN ranges below.
            if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
                candidates.push(addr.address);
            }
        }
    }
    return (
        candidates.find((a) => a.startsWith('192.168.')) ??
        candidates.find((a) => a.startsWith('10.')) ??
        candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
        candidates[0] ??
        null
    );
}

export default defineConfig(({command}) => ({
    base: './',
    root: '.',
    publicDir: 'public',
    server: {
        // Bind to every interface so phones on the same Wi-Fi can open the dev server.
        host: true,
    },
    build: {
        rolldownOptions: {
            // Keep `/*! @license */` notices (the Arimo OFL notice on the outlined glyphs, and the
            // dependencies' own); Vite drops legal comments when minifying unless this is set.
            output: {comments: {legal: true}},
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(resolveAppVersion(command)),
        __DEV_LAN_IP__: JSON.stringify(command === 'serve' ? resolveDevLanIpv4() : null),
    },
}));
