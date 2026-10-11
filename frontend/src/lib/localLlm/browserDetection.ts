export type BrowserFamily = 'brave' | 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export type OsPlatform = 'linux' | 'windows' | 'macos' | 'other';

export function detectBrowserFamily(
  nav: any = typeof navigator !== 'undefined' ? navigator : undefined
): BrowserFamily {
  if (!nav) return 'other';
  const ua = nav.userAgent || '';

  // Brave detection (navigator.brave API o userAgent)
  const isBrave = Boolean(
    nav.brave && typeof nav.brave.isBrave === 'function'
  ) || /\bBrave\b/i.test(ua);
  if (isBrave) return 'brave';

  if (/\bEdg\//i.test(ua)) return 'edge';
  if (/\bFirefox\b/i.test(ua)) return 'firefox';
  if (/\bSafari\b/i.test(ua) && !/\bChrome\b/i.test(ua)) return 'safari';
  if (/\bChrome\b|\bChromium\b/i.test(ua)) return 'chrome';

  return 'other';
}

export function detectOsPlatform(
  nav: any = typeof navigator !== 'undefined' ? navigator : undefined
): OsPlatform {
  if (!nav) return 'other';
  const ua = nav.userAgent || '';
  if (/Linux/i.test(ua)) return 'linux';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  return 'other';
}
