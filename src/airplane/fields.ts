import { Color, Vector2 } from 'three';

// Shared parcel boundaries drive both the ground shading and field-edge planting.
// All parcels lie beyond the flat, open flying meadow.
type Point = readonly [number, number];
export const FIELDS: { corners: readonly Point[]; color: number; angle: number; rows: number }[] = [
  {
    corners: [
      [-350, -72],
      [-155, -43],
      [-148, -164],
      [-370, -202],
    ],
    color: 0x8b9565,
    angle: 0.17,
    rows: 0.025,
  },
  {
    corners: [
      [-155, -43],
      [-30, -38],
      [-20, -144],
      [-148, -164],
    ],
    color: 0xb49d66,
    angle: 0.05,
    rows: 0.055,
  },
  {
    corners: [
      [-30, -38],
      [145, -60],
      [160, -164],
      [-20, -144],
    ],
    color: 0x75895c,
    angle: -0.13,
    rows: 0.035,
  },
  {
    corners: [
      [145, -60],
      [350, -43],
      [390, -174],
      [160, -164],
    ],
    color: 0x9a9e71,
    angle: 0.08,
    rows: 0.022,
  },
  {
    corners: [
      [-370, -202],
      [-148, -164],
      [-162, -325],
      [-410, -352],
    ],
    color: 0xa69060,
    angle: 1.4,
    rows: 0.045,
  },
  {
    corners: [
      [-148, -164],
      [-20, -144],
      [45, -280],
      [-162, -325],
    ],
    color: 0x83915f,
    angle: 0.24,
    rows: 0.025,
  },
  {
    corners: [
      [-20, -144],
      [160, -164],
      [187, -315],
      [45, -280],
    ],
    color: 0xb5a574,
    angle: 1.72,
    rows: 0.04,
  },
  {
    corners: [
      [160, -164],
      [390, -174],
      [430, -345],
      [187, -315],
    ],
    color: 0x7d8d66,
    angle: -0.07,
    rows: 0.025,
  },
  {
    corners: [
      [-410, -352],
      [-162, -325],
      [-90, -495],
      [-450, -505],
    ],
    color: 0x81916b,
    angle: 0.1,
    rows: 0.02,
  },
  {
    corners: [
      [-162, -325],
      [45, -280],
      [187, -315],
      [205, -505],
      [-90, -495],
    ],
    color: 0x9fa475,
    angle: 0.2,
    rows: 0.03,
  },
  {
    corners: [
      [187, -315],
      [430, -345],
      [470, -500],
      [205, -505],
    ],
    color: 0xa69568,
    angle: 1.4,
    rows: 0.035,
  },
];

const gl = (n: number) => n.toFixed(5);

/** Paint parcels into the existing ground shader: no raised overlays or depth offsets. */
export function fieldShader() {
  return FIELDS.map(({ corners, color, angle, rows }, index) => {
    const c = new Color(color);
    // Clockwise convex polygons: outward normals give negative distance inside.
    const distances = corners.map((a, i) => {
      const b = corners[(i + 1) % corners.length];
      const normal = new Vector2(a[1] - b[1], b[0] - a[0]).normalize();
      return `dot(p-vec2(${gl(a[0])},${gl(a[1])}),vec2(${gl(normal.x)},${gl(normal.y)}))`;
    });
    const distance = distances.reduce((a, b) => `max(${a},${b})`);
    return `{
      float boundary=${distance};
      if(boundary<max(.6,edge)) {
      float parcel=coverage(boundary+1.8+(noise(p*.07)-.5)*1.1,max(.6,edge));
      float rowPosition=dot(p,vec2(${gl(Math.cos(angle))},${gl(Math.sin(angle))}));
      float rowFootprint=dot(footprint,abs(vec2(${gl(Math.cos(angle))},${gl(Math.sin(angle))})));
      float rows=sin(rowPosition*1.05)*${gl(rows)}*(1.-smoothstep(.8,4.,rowFootprint));
      float mottling=(noise(p*.035+${gl(index * 7.1)})-.5)*.09;
      float headland=smoothstep(-9.,-3.,boundary)*.065;
      vec3 crop=vec3(${gl(c.r)},${gl(c.g)},${gl(c.b)})*(1.+rows+mottling-headland);
      diffuseColor.rgb=mix(diffuseColor.rgb,crop,parcel);
      }
    }`;
  }).join('\n');
}
