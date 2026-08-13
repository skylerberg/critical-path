import type { ViewBox } from './graph';

/**
 * The viewbox arithmetic behind panning, pinching and wheel zoom, as pure
 * functions of a box and the element's rect. Inside Graph.svelte none of it
 * could be tested — the numbers only exist mid-gesture — and every one of these
 * is a place an off-by-one puts the drawing somewhere the user did not ask for.
 *
 * The gesture state machine itself stays in the component. Pan and connect share
 * one set of window listeners and one `didDrag` flag, so splitting them would
 * mean each half holding a reference to the other's state: more indirection for
 * the same coupling.
 */

export const MIN_VB_WIDTH = 160;
export const FIT_PADDING = 32;
export const FIT_MIN_WIDTH = 640;

/** Structural, so a test can pass a plain object where the browser has a DOMRect. */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Drawing {
  width: number;
  height: number;
}

// The svg is letterboxed inside its element, so a degenerate box would otherwise
// divide by zero and put every later coordinate at NaN.
export function viewScale(v: ViewBox, rect: ViewRect): number {
  const scale = Math.min(rect.width / v.w, rect.height / v.h);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function svgPoint(
  v: ViewBox,
  rect: ViewRect,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const scale = viewScale(v, rect);
  const offsetX = (rect.width - v.w * scale) / 2;
  const offsetY = (rect.height - v.h * scale) / 2;
  return {
    x: v.x + (clientX - rect.left - offsetX) / scale,
    y: v.y + (clientY - rect.top - offsetY) / scale,
  };
}

export function clampVbWidth(w: number, layoutWidth: number): number {
  return Math.min(Math.max(w, MIN_VB_WIDTH), Math.max(layoutWidth * 4, 4000));
}

/** Whether the box still overlaps the drawing at all, rather than empty space. */
export function framesContent(box: ViewBox, drawing: Drawing): boolean {
  return box.x < drawing.width && box.x + box.w > 0 && box.y < drawing.height && box.y + box.h > 0;
}

// A narrow graph is centred rather than blown up to fill the viewport, which is
// what keeps two cards from rendering the size of a poster.
export function fitViewBox(drawing: Drawing): ViewBox {
  let x = -FIT_PADDING;
  let w = drawing.width + FIT_PADDING * 2;
  if (w < FIT_MIN_WIDTH) {
    x -= (FIT_MIN_WIDTH - w) / 2;
    w = FIT_MIN_WIDTH;
  }
  return { x, y: -FIT_PADDING, w, h: drawing.height + FIT_PADDING * 2 };
}

export interface PinchOrigin {
  vb: ViewBox;
  dist: number;
  midX: number;
  midY: number;
}

/**
 * The next box for a zoom anchored at a client point. During a pinch the anchor
 * is read from where the gesture started rather than from the current box, so
 * the content under the fingers stays under the fingers instead of drifting as
 * the box it is measured against changes.
 */
export function zoomedViewBox(opts: {
  vb: ViewBox;
  rect: ViewRect;
  width: number;
  anchorClientX: number;
  anchorClientY: number;
  layoutWidth: number;
  pinchOrigin?: PinchOrigin | null;
}): ViewBox {
  const { vb, rect, width, anchorClientX, anchorClientY, layoutWidth } = opts;
  const pinchOrigin = opts.pinchOrigin ?? null;
  const base = pinchOrigin?.vb ?? vb;
  const w = clampVbWidth(width, layoutWidth);
  const h = base.h * (w / base.w);
  const anchorSource = pinchOrigin
    ? svgPoint(pinchOrigin.vb, rect, pinchOrigin.midX, pinchOrigin.midY)
    : svgPoint(vb, rect, anchorClientX, anchorClientY);
  const next: ViewBox = { x: 0, y: 0, w, h };
  const scale = viewScale(next, rect);
  const offsetX = (rect.width - w * scale) / 2;
  const offsetY = (rect.height - h * scale) / 2;
  next.x = anchorSource.x - (anchorClientX - rect.left - offsetX) / scale;
  next.y = anchorSource.y - (anchorClientY - rect.top - offsetY) / scale;
  return next;
}

export interface PanOrigin {
  vb: ViewBox;
  x: number;
  y: number;
}

export function pannedViewBox(
  origin: PanOrigin,
  rect: ViewRect,
  clientX: number,
  clientY: number
): ViewBox {
  const scale = viewScale(origin.vb, rect);
  return {
    ...origin.vb,
    x: origin.vb.x - (clientX - origin.x) / scale,
    y: origin.vb.y - (clientY - origin.y) / scale,
  };
}
