import { describe, expect, it } from 'vitest';
import {
  clampVbWidth,
  fitViewBox,
  framesContent,
  pannedViewBox,
  svgPoint,
  viewScale,
  zoomedViewBox,
  FIT_MIN_WIDTH,
  FIT_PADDING,
  MIN_VB_WIDTH,
  type ViewRect,
} from './graph-viewport';

const rect: ViewRect = { left: 0, top: 0, width: 800, height: 600 };
const vb = { x: 0, y: 0, w: 800, h: 600 };

describe('viewScale', () => {
  it('is the smaller of the two ratios, so the drawing is letterboxed not cropped', () => {
    expect(viewScale({ x: 0, y: 0, w: 400, h: 600 }, rect)).toBe(1);
    expect(viewScale({ x: 0, y: 0, w: 1600, h: 600 }, rect)).toBe(0.5);
  });

  // A degenerate box would otherwise divide by zero and put every later
  // coordinate at NaN, which renders as nothing at all.
  it('falls back to 1 rather than producing NaN or Infinity', () => {
    expect(viewScale({ x: 0, y: 0, w: 0, h: 0 }, rect)).toBe(1);
    expect(viewScale(vb, { left: 0, top: 0, width: 0, height: 0 })).toBe(1);
  });
});

describe('svgPoint', () => {
  it('maps the element’s centre to the box’s centre', () => {
    expect(svgPoint(vb, rect, 400, 300)).toEqual({ x: 400, y: 300 });
  });

  it('accounts for the element’s offset on the page', () => {
    expect(svgPoint(vb, { left: 100, top: 50, width: 800, height: 600 }, 500, 350)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('accounts for the letterbox when the aspect ratios differ', () => {
    // 1600x800 in an 800x600 element scales by 0.5, filling the width and leaving
    // 100px bars top and bottom — so the drawing's origin sits 100px down.
    const wide = { x: 0, y: 0, w: 1600, h: 800 };

    expect(svgPoint(wide, rect, 0, 100)).toEqual({ x: 0, y: 0 });
    expect(svgPoint(wide, rect, 0, 0)).toEqual({ x: 0, y: -200 });
  });

  it('round-trips a panned and zoomed box', () => {
    const box = { x: 120, y: -40, w: 400, h: 300 };
    expect(svgPoint(box, rect, 400, 300)).toEqual({ x: 320, y: 110 });
  });
});

describe('clampVbWidth', () => {
  it('will not zoom in past the floor', () => {
    expect(clampVbWidth(10, 1000)).toBe(MIN_VB_WIDTH);
  });

  it('will not zoom out past four times the drawing, or 4000, whichever is larger', () => {
    expect(clampVbWidth(99_999, 1000)).toBe(4000);
    expect(clampVbWidth(99_999, 5000)).toBe(20_000);
  });

  it('leaves a width between the bounds alone', () => {
    expect(clampVbWidth(1200, 1000)).toBe(1200);
  });
});

describe('framesContent', () => {
  const drawing = { width: 1000, height: 800 };

  it('is true while the box overlaps the drawing at all', () => {
    expect(framesContent({ x: 0, y: 0, w: 100, h: 100 }, drawing)).toBe(true);
    expect(framesContent({ x: -50, y: -50, w: 100, h: 100 }, drawing)).toBe(true);
    expect(framesContent({ x: 950, y: 750, w: 100, h: 100 }, drawing)).toBe(true);
  });

  // This is what decides whether toggling done tasks keeps the user's pan or
  // refits: a box left pointing at empty space has to refit.
  it('is false once the box has left the drawing entirely', () => {
    expect(framesContent({ x: 1000, y: 0, w: 100, h: 100 }, drawing)).toBe(false);
    expect(framesContent({ x: -100, y: 0, w: 100, h: 100 }, drawing)).toBe(false);
    expect(framesContent({ x: 0, y: 800, w: 100, h: 100 }, drawing)).toBe(false);
  });
});

describe('fitViewBox', () => {
  it('pads the drawing on every side', () => {
    expect(fitViewBox({ width: 1000, height: 800 })).toEqual({
      x: -FIT_PADDING,
      y: -FIT_PADDING,
      w: 1000 + FIT_PADDING * 2,
      h: 800 + FIT_PADDING * 2,
    });
  });

  // Without this a two-card graph fills the viewport at poster size.
  it('centres a narrow drawing in the minimum width instead of magnifying it', () => {
    const box = fitViewBox({ width: 100, height: 80 });

    expect(box.w).toBe(FIT_MIN_WIDTH);
    expect(box.x + box.w / 2).toBeCloseTo(50, 6);
  });
});

describe('zoomedViewBox', () => {
  it('keeps the anchor point fixed while zooming in', () => {
    const before = svgPoint(vb, rect, 200, 150);
    const next = zoomedViewBox({
      vb,
      rect,
      width: 400,
      anchorClientX: 200,
      anchorClientY: 150,
      layoutWidth: 1000,
    });

    expect(next.w).toBe(400);
    expect(svgPoint(next, rect, 200, 150).x).toBeCloseTo(before.x, 6);
    expect(svgPoint(next, rect, 200, 150).y).toBeCloseTo(before.y, 6);
  });

  it('preserves the aspect ratio', () => {
    const next = zoomedViewBox({
      vb,
      rect,
      width: 400,
      anchorClientX: 400,
      anchorClientY: 300,
      layoutWidth: 1000,
    });

    expect(next.h / next.w).toBeCloseTo(vb.h / vb.w, 6);
  });

  it('clamps rather than zooming past the floor', () => {
    const next = zoomedViewBox({
      vb,
      rect,
      width: 1,
      anchorClientX: 400,
      anchorClientY: 300,
      layoutWidth: 1000,
    });

    expect(next.w).toBe(MIN_VB_WIDTH);
  });

  // During a pinch the anchor is read from where the gesture started, so content
  // under the fingers stays under the fingers instead of drifting.
  it('anchors a pinch on its origin, not on the current box', () => {
    const pinchOrigin = { vb: { ...vb }, dist: 100, midX: 200, midY: 150 };
    const drifted = { x: 300, y: 300, w: 500, h: 375 };

    const next = zoomedViewBox({
      vb: drifted,
      rect,
      width: 400,
      anchorClientX: 200,
      anchorClientY: 150,
      layoutWidth: 1000,
      pinchOrigin,
    });

    expect(svgPoint(next, rect, 200, 150).x).toBeCloseTo(
      svgPoint(pinchOrigin.vb, rect, 200, 150).x,
      6
    );
  });
});

describe('pannedViewBox', () => {
  it('moves the box opposite the drag, by the drag distance in box units', () => {
    const origin = { vb: { ...vb }, x: 400, y: 300 };

    expect(pannedViewBox(origin, rect, 500, 350)).toEqual({ x: -100, y: -50, w: 800, h: 600 });
  });

  it('scales the drag by the zoom, so a zoomed-in pan moves less', () => {
    const origin = { vb: { x: 0, y: 0, w: 400, h: 300 }, x: 400, y: 300 };

    expect(pannedViewBox(origin, rect, 500, 300).x).toBe(-50);
  });

  // Measured from the gesture origin, so only the delta matters. An
  // implementation reaching for the absolute client coordinates instead would
  // pass every case above — they all start a drag at the middle of the screen —
  // and put the board somewhere else for a drag that started anywhere but there.
  it('depends on the drag delta, not on where on the screen the drag happened', () => {
    const fromCentre = pannedViewBox({ vb: { ...vb }, x: 400, y: 300 }, rect, 450, 320);
    const fromCorner = pannedViewBox({ vb: { ...vb }, x: 100, y: 50 }, rect, 150, 70);

    expect(fromCorner).toEqual(fromCentre);
  });

  it('leaves the box exactly where it was for a drag that has not moved', () => {
    const origin = { vb: { x: 120, y: -40, w: 400, h: 300 }, x: 275, y: 190 };

    expect(pannedViewBox(origin, rect, 275, 190)).toEqual(origin.vb);
  });
});
