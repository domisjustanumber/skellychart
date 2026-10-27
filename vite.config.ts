import {readFileSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {defineConfig} from 'vite';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Vite bundles this config to a temp file, so resolve from the project cwd (npm scripts run there).
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
};
if (!SEMVER.test(pkg.version)) {
    throw new Error(`package.json "version" must be semver, got ${String(pkg.version)}`);
}

/**
 * Fixed dev token, deliberately 7 characters like the current release semver (`1.10.10`).
 * Dev-printed charts then keep the same banner layout and QR density as production while
 * still being obviously not a release.
 */
const DEV_APP_VERSION = 'develop';

/**
 * - `npm run dev`: the literal {@link DEV_APP_VERSION}, so a dev-printed QR is never mistaken
 *   for a release and the printed banner/QR stay the same width as production.
 * - `npm run build` / CI: the exact package.json version.
 * - `VITE_APP_VERSION` is an optional one-off override; CI does not set it.
 */
function resolveAppVersion(command: 'build' | 'serve'): string {
    const override = process.env.VITE_APP_VERSION?.trim();
    if (override) {
        return override;
    }
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
    define: {
        __APP_VERSION__: JSON.stringify(resolveAppVersion(command)),
        __DEV_LAN_IP__: JSON.stringify(command === 'serve' ? resolveDevLanIpv4() : null),
    },
}));
