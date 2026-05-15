/** Shared base64 decode for generated tiling feasibility blobs (keeps paper chunks small). */

export function decodeBytesFromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

export function decodeMmBitmap(bytes: Uint8Array, byteOffset: number, sqMmMin: number, sqMmMax: number): number[] {
    const out: number[] = [];
    for (let mm = sqMmMin; mm <= sqMmMax; mm++) {
        const bit = mm - sqMmMin;
        if ((bytes[byteOffset + (bit >> 3)]! >> (bit & 7)) & 1) {
            out.push(mm);
        }
    }
    return out;
}
