import { describe, expect, it } from 'vitest';
import { describeDevice } from './userAgent';

describe('describeDevice', () => {
  it('names the browser and the platform', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome on macOS');
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
      )
    ).toBe('Firefox on Windows');
    expect(
      describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0')
    ).toBe('Firefox on Linux');
    expect(
      describeDevice(
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome on ChromeOS');
  });

  it('picks the browser that only one vendor claims, not the ones they all claim', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51'
      )
    ).toBe('Edge on Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/122.0.0.0 Safari/537.36 OPR/108.0.0.0'
      )
    ).toBe('Opera on Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'
      )
    ).toBe('Samsung Internet on Android');
  });

  it('reads an iOS agent as its real browser and its real device', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari on iPhone');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Chrome on iPhone');
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Mobile Safari/537.36'
      )
    ).toBe('Chrome on Android');
  });

  it('names whichever half it recognises when it cannot recognise both', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(describeDevice('Chrome/124.0.0.0')).toBe('Chrome');
  });

  it('falls back to the agent itself, which is how a script or a CLI names itself', () => {
    expect(describeDevice('cpath-cli/1.4.0')).toBe('cpath-cli/1.4.0');
    expect(describeDevice(`${'x'.repeat(70)}`)).toBe(`${'x'.repeat(60)}…`);
  });

  it('calls an absent or blank user agent an unknown device', () => {
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice(undefined)).toBe('Unknown device');
    expect(describeDevice('   ')).toBe('Unknown device');
  });
});
