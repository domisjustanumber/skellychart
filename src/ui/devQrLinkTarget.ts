import {buildCharucoDocumentationUrl} from '../print/charucoDocUrl.js';
import {
    getQrLinkTarget,
    isQrLinkTargetSwitchAvailable,
    resolveQrLinkSourceUrlFor,
    setQrLinkTarget,
} from '../print/qrLinkTarget.js';
import {linkTarget, state} from './appState.js';

/**
 * Dev-only control: choose whether QR links target production or this dev server. The encoded
 * URL is shown as a link so query-parameter round-tripping can be tested without a phone.
 * Not created at all in release builds. `onChange` runs after the target changes.
 */
export function initDevQrLinkTargetUi(onChange: () => void): void {
    if (!isQrLinkTargetSwitchAvailable()) {
        return;
    }
    const advanced = document.getElementById('advancedSettings');
    if (!advanced) {
        return;
    }

    const field = document.createElement('fieldset');
    field.className = 'qr-link-target-field';

    const legend = document.createElement('legend');
    legend.textContent = 'QR link target (dev only)';

    const options = document.createElement('div');
    options.className = 'qr-link-target-options';
    for (const [value, text] of [
        ['production', 'Production (skelly.cam)'],
        ['local', 'Local dev server (LAN)'],
    ] as const) {
        const row = document.createElement('div');
        row.className = 'qr-link-target-option-row';

        const label = document.createElement('label');
        label.className = 'qr-link-target-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'qrLinkTarget';
        input.value = value;
        input.checked = getQrLinkTarget() === value;
        input.addEventListener('change', () => {
            if (!input.checked) {
                return;
            }
            setQrLinkTarget(value);
            onChange();
        });

        const link = document.createElement('a');
        link.className = 'caption qr-link-url';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'Open this URL to test QR query parsing';
        link.dataset.qrTarget = value;

        label.append(input, document.createTextNode(text));
        row.append(label, link);
        options.appendChild(row);
    }

    field.append(legend, options);
    advanced.insertAdjacentElement('afterend', field);
}

/** Keeps the dev-only QR target radios and both candidate URLs in sync with the current chart. */
export function syncDevQrLinkTargetUi(): void {
    const inputs = document.querySelectorAll<HTMLInputElement>(
        '.qr-link-target-field input[name="qrLinkTarget"]',
    );
    const links = document.querySelectorAll<HTMLAnchorElement>(
        '.qr-link-target-field a.qr-link-url',
    );
    if (inputs.length === 0 || links.length === 0) {
        return;
    }
    const target = getQrLinkTarget();
    for (const input of inputs) {
        input.checked = input.value === target;
    }
    const {squaresX, squaresY} = state;
    for (const link of links) {
        const qrTarget = link.dataset.qrTarget === 'local' ? 'local' : 'production';
        const url = buildCharucoDocumentationUrl(
            resolveQrLinkSourceUrlFor(qrTarget),
            squaresX,
            squaresY,
            state.squareMm,
            linkTarget(),
        );
        link.href = url;
        link.textContent = url;
    }
}
