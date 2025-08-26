import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';

export function buildAgent(proxyUrl) {
  if (!proxyUrl) {
    return {
      http: undefined,
      https: undefined
    };
  }
  
  // For HTTPS and SOCKS proxies
  if (proxyUrl.startsWith('https://') || proxyUrl.startsWith('socks')) {
    const agent = new HttpsProxyAgent(proxyUrl);
    return {
      http: agent,
      https: agent
    };
  }
  
  // For HTTP proxies
  const agent = new HttpProxyAgent(proxyUrl);
  return {
    http: agent,
    https: agent
  };
}
