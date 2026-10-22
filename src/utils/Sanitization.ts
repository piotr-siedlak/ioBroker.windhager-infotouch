/** Mask an IPv4 address or hostname for diagnostics exports. */
export function maskHost(host: string): string {
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
    if (ipv4) {
        return `${ipv4[1]}.${ipv4[2]}.*.*`;
    }
    return host.length <= 2 ? '***' : `${host[0]}***${host[host.length - 1]}`;
}

/** Keep only the first and last two characters of serial-like identifiers (Neuron ID, program ID). */
export function maskSerial(value: string): string {
    return value.length <= 4
        ? '****'
        : `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

/**
 * Remove anything that could be a credential or authentication header from a message before logging.
 *
 * @param message Text that may include sensitive substrings
 * @param secrets Literal secrets to scrub (e.g. the configured password)
 */
export function scrub(message: string, secrets: string[] = []): string {
    let out = message.replace(/(authorization|cookie|www-authenticate)\s*[:=]\s*[^\r\n]*/gi, '$1: [redacted]');
    out = out.replace(/(response|nonce|cnonce|opaque|password)\s*=\s*"[^"]*"/gi, '$1="[redacted]"');
    for (const secret of secrets) {
        if (secret) {
            out = out.split(secret).join('[redacted]');
        }
    }
    return out;
}
