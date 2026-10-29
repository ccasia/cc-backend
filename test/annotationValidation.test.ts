import { validateAnnotationPayload } from '../src/utils/annotationValidation';

// Mirrors what the frontend's buildAnnotationPayload sends (cc-frontend
// src/components/video-annotation/annotation-shapes.js)
const rect = { type: 'rect', x: 0.1, y: 0.1, w: 0.3, h: 0.2, color: '#FF0000', stroke: 3 };
const arrow = { type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.9, y2: 0.2, color: '#0000FF', stroke: 6 };
const freehand = {
  type: 'freehand',
  points: [
    [0.1, 0.8],
    [0.2, 0.75],
    [0.3, 0.8],
  ],
  color: '#00FF00',
  stroke: 2,
};
const text = { type: 'text', x: 0.4, y: 0.3, value: 'Too dark here', color: '#FFFFFF', size: 0.035 };

const payload = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  frameTimeMs: 12_345,
  canvas: { aspect: 9 / 16 },
  shapes: [rect, arrow, freehand, text],
  ...overrides,
});

const withShape = (shape: unknown) => payload({ shapes: [shape] });

describe('validateAnnotationPayload', () => {
  it('accepts every shape type as the frontend sends it', () => {
    expect(validateAnnotationPayload(payload())).toBeNull();
  });

  it('accepts shapes without the optional colour, stroke, size and background', () => {
    const bare = [
      { type: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 },
      {
        type: 'freehand',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      { type: 'text', x: 0.5, y: 0.5, value: 'hi' },
    ];
    expect(validateAnnotationPayload(payload({ shapes: bare }))).toBeNull();
  });

  describe('payload', () => {
    it.each([null, undefined, 'drawing', 42, [], [rect]])('rejects %p', (value) => {
      expect(validateAnnotationPayload(value)).toBe('Annotation must be an object');
    });

    it('rejects payloads over the size limit before looking inside', () => {
      expect(validateAnnotationPayload(payload({ pad: 'x'.repeat(50_001) }))).toBe('Annotation payload too large');
    });

    it.each([undefined, 0, 2, '1'])('rejects version %p', (v) => {
      expect(validateAnnotationPayload(payload({ v }))).toBe('Unsupported annotation version');
    });

    it.each([undefined, -1, 1.5, '1000', NaN, 2_147_483_648])('rejects frame time %p', (frameTimeMs) => {
      expect(validateAnnotationPayload(payload({ frameTimeMs }))).toBe('Invalid annotation frame time');
    });

    it('accepts the first frame and the largest frame time the column can hold', () => {
      expect(validateAnnotationPayload(payload({ frameTimeMs: 0 }))).toBeNull();
      expect(validateAnnotationPayload(payload({ frameTimeMs: 2_147_483_647 }))).toBeNull();
    });

    it.each([undefined, [], 'shapes', { 0: rect }])('rejects shapes %p', (shapes) => {
      expect(validateAnnotationPayload(payload({ shapes }))).toBe('Annotation must contain at least one shape');
    });

    it('allows up to 100 shapes', () => {
      expect(validateAnnotationPayload(payload({ shapes: Array(100).fill(rect) }))).toBeNull();
      expect(validateAnnotationPayload(payload({ shapes: Array(101).fill(rect) }))).toBe('Too many annotation shapes');
    });
  });

  describe('shape', () => {
    it.each([null, 'rect', 7, [rect]])('rejects %p as a shape', (shape) => {
      expect(validateAnnotationPayload(withShape(shape))).toBe('Invalid annotation shape');
    });

    it.each(['circle', undefined, ''])('rejects unknown type %p', (type) => {
      expect(validateAnnotationPayload(withShape({ ...rect, type }))).toMatch(/^Unknown annotation shape type/);
    });

    // Validators are looked up by type, so inherited Object keys must not count as types
    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
      'rejects prototype key %p as a type',
      (type) => {
        expect(validateAnnotationPayload(withShape({ ...rect, type }))).toMatch(/^Unknown annotation shape type/);
      },
    );

    it('stops at the first invalid shape', () => {
      expect(validateAnnotationPayload(payload({ shapes: [rect, { ...arrow, color: 'blue' }, { type: 'x' }] }))).toBe(
        'Invalid shape color',
      );
    });
  });

  describe('colour', () => {
    it.each(['#ff0000', '#A1b2C3'])('accepts %p', (color) => {
      expect(validateAnnotationPayload(withShape({ ...rect, color }))).toBeNull();
    });

    it.each(['red', '#FFF', '#GGGGGG', '#FF0000AA', 'FF0000', null, 255])('rejects %p', (color) => {
      expect(validateAnnotationPayload(withShape({ ...rect, color }))).toBe('Invalid shape color');
    });
  });

  describe('stroke', () => {
    it.each([1, 2, 3, 6, 20])('accepts %p', (stroke) => {
      expect(validateAnnotationPayload(withShape({ ...arrow, stroke }))).toBeNull();
    });

    it.each([0, 0.5, 21, -3, '3', null, Infinity])('rejects %p', (stroke) => {
      expect(validateAnnotationPayload(withShape({ ...arrow, stroke }))).toBe('Invalid shape stroke width');
    });
  });

  describe('geometry', () => {
    it.each([
      ['a box past the right edge', { ...rect, x: 1.2 }],
      ['a box with a negative height', { ...rect, h: -0.1 }],
      ['a box missing its height', { type: 'rect', x: 0.1, y: 0.1, w: 0.2 }],
      ['an arrow with a string coordinate', { ...arrow, y2: '0.5' }],
      ['an arrow with NaN', { ...arrow, x1: NaN }],
      ['an arrow with Infinity', { ...arrow, x2: Infinity }],
    ])('rejects %s', (_, shape) => {
      expect(validateAnnotationPayload(withShape(shape))).toBe('Invalid annotation shape geometry');
    });

    it.each([
      ['a single point', [[0.1, 0.1]]],
      [
        'a point outside the frame',
        [
          [0.1, 0.1],
          [1.1, 0.2],
        ],
      ],
      ['a point with one coordinate', [[0.1, 0.1], [0.2]]],
      [
        'a point with three coordinates',
        [
          [0.1, 0.1],
          [0.2, 0.2, 0.2],
        ],
      ],
      [
        'points that are objects',
        [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
      ],
      ['too many points', Array(2_001).fill([0.5, 0.5])],
    ])('rejects a freehand line with %s', (_, points) => {
      expect(validateAnnotationPayload(withShape({ ...freehand, points }))).toBe('Invalid annotation shape geometry');
    });

    it('accepts a freehand line at the point limit', () => {
      expect(validateAnnotationPayload(withShape({ ...freehand, points: Array(2_000).fill([0.5, 0.5]) }))).toBeNull();
    });
  });

  describe('text', () => {
    it('accepts text up to 300 characters', () => {
      expect(validateAnnotationPayload(withShape({ ...text, value: 'a'.repeat(300) }))).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['only whitespace', '   '],
      ['over 300 characters', 'a'.repeat(301)],
      ['not a string', 42],
    ])('rejects a value that is %s', (_, value) => {
      expect(validateAnnotationPayload(withShape({ ...text, value }))).toBe('Invalid annotation shape geometry');
    });

    it.each([-0.1, 1.5, '0.035'])('rejects size %p', (size) => {
      expect(validateAnnotationPayload(withShape({ ...text, size }))).toBe('Invalid annotation shape geometry');
    });

    it.each(['#000000', '#ffcc00', null])('accepts background %p', (bg) => {
      expect(validateAnnotationPayload(withShape({ ...text, bg }))).toBeNull();
    });

    it.each(['black', '#000', '#00000080', 0])('rejects background %p', (bg) => {
      expect(validateAnnotationPayload(withShape({ ...text, bg }))).toBe('Invalid annotation shape geometry');
    });
  });
});
