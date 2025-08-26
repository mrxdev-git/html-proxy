import dnsDefault from 'dns/promises';
import net from 'net';

// Allow DNS to be injected for testing
let dns = dnsDefault;

export function setDnsModule(dnsModule) {
  dns = dnsModule;
}

function isIpPrivate(ip) {
  if (!net.isIP(ip)) return false;
  const parts = ip.split('.').map(Number);
  // RFC1918 + loopback + link-local
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

export function hostnameMatchesBlocklist(hostname, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) {
      const suffix = p.slice(1); // remove leading *
      return host.endsWith(suffix);
    }
    return host === p;
  });
}

export async function validateUrlSafety(urlString, { allowPrivateNetworks = false, blocklistHosts = [] } = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch (e) {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https protocols are allowed');
  }
  if (hostnameMatchesBlocklist(url.hostname, blocklistHosts)) {
    throw new Error('Host is blocked');
  }
  const addrs = await dns.lookup(url.hostname, { all: true, verbatim: false });
  if (!allowPrivateNetworks) {
    for (const a of addrs) {
      if (isIpPrivate(a.address)) {
        throw new Error('Target resolves to a private IP (SSRF protection)');
      }
    }
  }
  return url;
}
