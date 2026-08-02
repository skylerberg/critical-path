const UNKNOWN_DEVICE = 'Unknown device';
const MAX_RAW_LENGTH = 60;

// Ordered, because every Chromium browser also claims Chrome and Safari and
// every iOS browser claims Safari: the specific name has to win.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

// Android before Linux for the same reason: an Android agent says both.
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(pairs: [RegExp, string][], value: string): string | null {
  return pairs.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function describeDevice(userAgent: string | null | undefined): string {
  const value = userAgent?.trim() ?? '';
  if (value === '') {
    return UNKNOWN_DEVICE;
  }

  const browser = firstMatch(BROWSERS, value);
  const platform = firstMatch(PLATFORMS, value);
  if (browser !== null && platform !== null) {
    return `${browser} on ${platform}`;
  }
  if (browser !== null) {
    return browser;
  }
  if (platform !== null) {
    return platform;
  }

  // Unrecognized agents are scripts and CLIs far more often than browsers, and
  // their own name is a better answer than calling them unknown.
  return value.length > MAX_RAW_LENGTH ? `${value.slice(0, MAX_RAW_LENGTH)}…` : value;
}
