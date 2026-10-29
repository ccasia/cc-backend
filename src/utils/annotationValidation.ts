// Validates the drawing attached to a SubmissionComment. Coordinates are normalised 0-1
// against the video frame so a drawing renders the same at any player size.

const MAX_PAYLOAD_BYTES = 50_000;
const MAX_SHAPES = 100;
const MAX_TEXT_LENGTH = 300;
const MAX_FREEHAND_POINTS = 2_000;
// SubmissionComment.frameTimeMs is a Postgres Int; anything larger fails the insert (a 500)
const MAX_FRAME_TIME_MS = 2_147_483_647;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Payload: { v, frameTimeMs, canvas: { aspect }, shapes: [...] }
const ANNOTATION_VERSION = 1;

const isCoord = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

const isValidStroke = (n: unknown): boolean =>
  n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 20);

type ShapeValidator = (shape: Record<string, any>) => boolean;

const shapeValidators: Record<string, ShapeValidator> = {
  rect: (s) => isCoord(s.x) && isCoord(s.y) && isCoord(s.w) && isCoord(s.h),
  arrow: (s) => isCoord(s.x1) && isCoord(s.y1) && isCoord(s.x2) && isCoord(s.y2),
  freehand: (s) =>
    Array.isArray(s.points) &&
    s.points.length >= 2 &&
    s.points.length <= MAX_FREEHAND_POINTS &&
    s.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && isCoord(p[0]) && isCoord(p[1])),
  text: (s) =>
    isCoord(s.x) &&
    isCoord(s.y) &&
    typeof s.value === 'string' &&
    s.value.trim().length > 0 &&
    s.value.length <= MAX_TEXT_LENGTH &&
    (s.size === undefined || isCoord(s.size)) &&
    // Optional background behind the text
    (s.bg === undefined || s.bg === null || HEX_COLOR.test(String(s.bg))),
};

/** Returns an error message, or null when the payload is valid. */
export const validateAnnotationPayload = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Annotation must be an object';
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return 'Annotation payload too large';
  }

  const p = payload as Record<string, any>;
  if (p.v !== ANNOTATION_VERSION) return 'Unsupported annotation version';
  if (!Number.isInteger(p.frameTimeMs) || p.frameTimeMs < 0 || p.frameTimeMs > MAX_FRAME_TIME_MS) {
    return 'Invalid annotation frame time';
  }
  if (!Array.isArray(p.shapes) || p.shapes.length === 0) {
    return 'Annotation must contain at least one shape';
  }
  if (p.shapes.length > MAX_SHAPES) return 'Too many annotation shapes';

  for (const shape of p.shapes) {
    if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) {
      return 'Invalid annotation shape';
    }
    // Own keys only: inherited ones ('constructor', 'toString', ...) would find an Object
    // method that returns something truthy and wave the shape through
    const isKnownType = Object.prototype.hasOwnProperty.call(shapeValidators, shape.type);
    if (!isKnownType) return `Unknown annotation shape type: ${String(shape.type)}`;
    const validate = shapeValidators[shape.type as string];
    if (shape.color !== undefined && !HEX_COLOR.test(String(shape.color))) {
      return 'Invalid shape color';
    }
    if (!isValidStroke(shape.stroke)) return 'Invalid shape stroke width';
    if (!validate(shape)) return 'Invalid annotation shape geometry';
  }

  return null;
};
