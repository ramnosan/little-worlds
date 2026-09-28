import * as THREE from 'three';

// Metres; X is span, Y is up, -Z is the nose. Every part is made here.
// This is an exterior design study, not an engineering or aerodynamic model.
export function createRaptor() {
  const jet = new THREE.Group();
  jet.name = 'F-22 Raptor';
  const material = (color, roughness = 0.55, metalness = 0.35) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const paint = material('#788691'),
    secondary = material('#626f7c'),
    edge = material('#9ca8ae');
  const dark = material('#182027', 0.8, 0.12),
    seam = material('#55636d', 0.64);
  const metal = material('#a6b2b8', 0.28, 0.86),
    titanium = material('#626267', 0.42, 0.8);
  const rubber = material('#20252a', 0.94, 0.02),
    bayMat = material('#66736f', 0.76, 0.2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#343c39',
    metalness: 0.5,
    roughness: 0.13,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.8,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: '#241d22',
    emissive: '#ef7842',
    emissiveIntensity: 0,
    roughness: 0.8,
  });
  const red = new THREE.MeshStandardMaterial({
    color: '#931f21',
    emissive: '#ff241c',
    emissiveIntensity: 0.8,
  });
  const green = new THREE.MeshStandardMaterial({
    color: '#216e55',
    emissive: '#35efad',
    emissiveIntensity: 0.6,
  });
  const white = new THREE.MeshStandardMaterial({
    color: '#d1dad4',
    emissive: '#d1e9de',
    emissiveIntensity: 0.4,
  });
  const cube = new THREE.BoxGeometry(1, 1, 1),
    ball = new THREE.SphereGeometry(1, 16, 10);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const axisY = new THREE.Vector3(0, 1, 0);
  const v = (a) => new THREE.Vector3(...a);
  function mesh(geometry, mat, parent = jet, name = '') {
    const obj = new THREE.Mesh(geometry, mat);
    obj.name = name;
    obj.castShadow = true;
    obj.receiveShadow = true;
    parent.add(obj);
    return obj;
  }
  function box(position, scale, mat, parent = jet) {
    const obj = mesh(cube, mat, parent);
    obj.position.fromArray(position);
    obj.scale.fromArray(scale);
    return obj;
  }
  function sphere(position, scale, mat, parent = jet) {
    const obj = mesh(ball, mat, parent);
    obj.position.fromArray(position);
    obj.scale.fromArray(scale);
    return obj;
  }
  function rod(a, b, radius, mat, parent = jet) {
    const d = v(b).sub(v(a)),
      obj = mesh(cylinder, mat, parent);
    obj.position.copy(v(a).add(v(b)).multiplyScalar(0.5));
    obj.quaternion.setFromUnitVectors(axisY, d.clone().normalize());
    obj.scale.set(radius, d.length(), radius);
    return obj;
  }
  function line(points, mat = seam, radius = 0.009, parent = jet, closed = false) {
    const p = points.map(v);
    if (closed) p.push(p[0].clone());
    const obj = mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(p, false, 'catmullrom', 0),
        Math.max(12, p.length * 4),
        radius,
        5,
        false,
      ),
      mat,
      parent,
    );
    obj.castShadow = radius > 0.02;
    return obj;
  }
  // Closed, solid plates with independent cap and edge normals.
  function plate(points, thickness, mat, parent = jet, normal = [0, 1, 0]) {
    const n = v(normal).normalize(),
      p = points.map(v),
      count = p.length;
    const u = p[1].clone().sub(p[0]).normalize(),
      w = new THREE.Vector3().crossVectors(n, u);
    const contour = p.map((a) => new THREE.Vector2(a.dot(u), a.dot(w)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []),
      vertices = [];
    const emit = (a, b, c) => vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    const top = p.map((a) => a.clone().addScaledVector(n, thickness / 2));
    const bottom = p.map((a) => a.clone().addScaledVector(n, -thickness / 2));
    for (const [a, b, c] of faces) {
      emit(top[a], top[b], top[c]);
      emit(bottom[c], bottom[b], bottom[a]);
    }
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      // Correct side winding independently of the contour order.
      if (THREE.ShapeUtils.isClockWise(contour)) {
        emit(top[i], bottom[j], top[j]);
        emit(top[i], bottom[i], bottom[j]);
      } else {
        emit(top[i], top[j], bottom[j]);
        emit(top[i], bottom[j], bottom[i]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    // TriangulateShape uses clockwise caps; orient their normals to the requested normal.
    const pos = geometry.getAttribute('position');
    const a = new THREE.Vector3().fromBufferAttribute(pos, 0),
      b = new THREE.Vector3().fromBufferAttribute(pos, 1),
      c = new THREE.Vector3().fromBufferAttribute(pos, 2);
    if (b.sub(a).cross(c.sub(a)).dot(n) < 0) {
      for (let i = 0; i < faces.length * 6; i += 3) {
        const temp = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, ...temp);
      }
      geometry.computeVertexNormals();
    }
    return mesh(geometry, mat, parent);
  }

  // Continuous chine-to-chine hull. Engine shoulders are part of this surface,
  // rather than cylinders intersecting a separate fuselage.
  const stations = [
    [-9.45, 0.012, 0.01, 0.01],
    [-8.8, 0.28, 0.16, 0.14],
    [-7.5, 0.66, 0.38, 0.28],
    [-6.4, 0.91, 0.51, 0.37],
    [-5.1, 1.18, 0.62, 0.46],
    [-3.8, 1.66, 0.66, 0.5],
    [-2.5, 2.06, 0.65, 0.53],
    [0, 2.22, 0.61, 0.57],
    [2.4, 2.24, 0.52, 0.57],
    [4.6, 2.1, 0.42, 0.5],
    [6.5, 1.99, 0.32, 0.4],
    [8.25, 1.88, 0.23, 0.28],
  ];
  function section(z) {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
    const a = stations[i],
      b = stations[i + 1],
      t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return [
      THREE.MathUtils.lerp(a[1], b[1], t),
      THREE.MathUtils.lerp(a[2], b[2], t),
      THREE.MathUtils.lerp(a[3], b[3], t),
    ];
  }
  function surface(x, z, top = true) {
    const [width, height, depth] = section(z),
      t = Math.min(1, Math.abs(x) / width);
    if (!top) return -depth * Math.pow(Math.max(0, 1 - t ** 4), 0.55);
    const shoulders =
      Math.exp(-(((Math.abs(x) - 1.1) / 0.49) ** 2)) *
      0.26 *
      THREE.MathUtils.smoothstep(z, -3.8, -0.8);
    return (height * Math.pow(1 - t * t, 0.75) + shoulders) * (1 - 0.1 * t);
  }
  const nx = 56,
    nz = 120,
    positions = [],
    indices = [];
  // Gear wells are actual openings in the lower surface, with connected walls.
  const wells = [
    { x: 0, z: -5.1, width: 0.68, length: 1.9, roof: -0.1 },
    ...[-1, 1].map((s) => ({ x: s * 1.44, z: 1.3, width: 0.85, length: 2.08, roof: 0.08 })),
  ];
  for (const top of [true, false]) {
    const base = positions.length / 3;
    for (let j = 0; j <= nz; j++) {
      const z = -9.45 + (j / nz) * 17.7,
        width = section(z)[0];
      for (let i = 0; i <= nx; i++) {
        const x = ((i / nx) * 2 - 1) * width;
        positions.push(x, surface(x, z, top), z);
      }
    }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1,
          d = c + 1;
        const x = (positions[a * 3] + positions[d * 3]) / 2,
          z = (positions[a * 3 + 2] + positions[d * 3 + 2]) / 2;
        // The inlet occupies this side/belly volume; its walls replace the hull
        // here so the fuselage cannot seal the duct behind its leading lip.
        if (
          z > -4.27 &&
          z < -2.63 &&
          Math.abs(x) > 1.01 &&
          Math.abs(x) < 1.99 &&
          (!top || surface(x, z) < 0.34)
        )
          continue;
        if (
          !top &&
          wells.some(
            (well) =>
              Math.abs(x - well.x) < well.width / 2 + 0.035 &&
              Math.abs(z - well.z) < well.length / 2 + 0.06,
          )
        )
          continue;
        if (top) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hullGeo.setIndex(indices);
  hullGeo.computeVertexNormals();
  const hull = mesh(hullGeo, paint, jet, 'Blended fuselage');
  // Seal both ends (the forward cap is only millimetres across).
  for (const z of [-9.45, 8.25]) {
    const width = section(z)[0],
      ring = [];
    for (let i = 0; i <= nx; i++) {
      const x = ((i / nx) * 2 - 1) * width;
      ring.push([x, surface(x, z), z]);
    }
    for (let i = nx; i >= 0; i--) {
      const x = ((i / nx) * 2 - 1) * width;
      ring.push([x, surface(x, z, false), z]);
    }
    plate(ring, 0.004, paint, jet, [0, 0, z < 0 ? -1 : 1]);
  }
  // A shared surface parameterization keeps seams and fitted glazing on the hull.
  function skinPath(points, mat = seam, radius = 0.009, top = true) {
    return line(
      points.map(([x, z]) => [x, surface(x, z, top) + (top ? 0.007 : -0.007), z]),
      mat,
      radius,
    );
  }
  for (const z of [-7.05, -2.6, 0.2, 3.3, 6.6]) {
    const width = section(z)[0];
    skinPath(
      Array.from({ length: 45 }, (_, i) => [((i / 44) * 2 - 1) * width * 0.98, z]),
      seam,
      0.009,
    );
  }
  for (const side of [-1, 1]) {
    skinPath(
      [
        [-6.9, 0.45],
        [-5.9, 0.75],
        [-4, 1.22],
        [-1.3, 1.64],
        [2.6, 1.72],
        [6.6, 1.58],
      ].map(([z, x]) => [x * side, z]),
    );
    for (const [x, z, width, length] of [
      [0.72, -1.45, 0.4, 0.9],
      [1.15, 2.1, 0.46, 0.65],
      [0.49, 4.7, 0.42, 0.8],
    ]) {
      const p = [
        [x - width / 2, z - length / 2],
        [x + width / 2, z - length / 2],
        [x + width / 2, z + length / 2],
        [x - width / 2, z + length / 2],
        [x - width / 2, z - length / 2],
      ].map(([px, pz]) => [px * side, pz]);
      skinPath(p, seam, 0.008);
    }
    // Flush zigzag belly access panels beside the gear wells.
    skinPath(
      [
        [0.12, -2.9],
        [0.65, -2.65],
        [0.85, -2.9],
        [0.9, -0.1],
        [0.7, 0.1],
        [0.12, -0.1],
        [0.12, -2.9],
      ].map(([x, z]) => [side * x, z]),
      seam,
      0.011,
      false,
    );
    for (let i = 0; i < 6; i++) {
      const x = side * (0.85 + i * 0.06),
        z = 3.75;
      skinPath(
        [
          [x, z],
          [x, z + 0.55],
        ],
        dark,
        0.013,
      );
    }
  }

  // Bubble canopy: every boundary vertex is seated on the same fuselage surface.
  function canopyPoint(t, angle, lift = 0) {
    const z = -6.65 + t * 3.65,
      envelope = Math.pow(Math.sin(Math.PI * t), 0.68);
    const x = 0.61 * envelope * Math.cos(angle);
    return [x, surface(x, z) + 0.025 + 0.68 * envelope * Math.sin(angle) + lift, z];
  }
  const cp = [],
    ci = [],
    lengthSteps = 56,
    arcSteps = 28;
  for (let j = 0; j <= lengthSteps; j++)
    for (let i = 0; i <= arcSteps; i++)
      cp.push(...canopyPoint(j / lengthSteps, (i / arcSteps) * Math.PI));
  for (let j = 0; j < lengthSteps; j++)
    for (let i = 0; i < arcSteps; i++) {
      const a = j * (arcSteps + 1) + i,
        b = a + arcSteps + 1;
      ci.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const canopyGeo = new THREE.BufferGeometry();
  canopyGeo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  canopyGeo.setIndex(ci);
  canopyGeo.computeVertexNormals();
  mesh(canopyGeo, glass, jet, 'Fitted tinted canopy');
  for (const angle of [0, Math.PI])
    line(
      Array.from({ length: 57 }, (_, i) => canopyPoint(i / 56, angle)),
      edge,
      0.035,
    );
  line(
    Array.from({ length: 35 }, (_, i) => canopyPoint(0.18, (i / 34) * Math.PI, 0.004)),
    secondary,
    0.026,
  );
  line(
    Array.from({ length: 35 }, (_, i) => canopyPoint(0.94, (i / 34) * Math.PI, 0.002)),
    paint,
    0.037,
  );

  const moving = [],
    nozzles = [],
    fans = [],
    landingGear = [],
    doors = [];
  function hinge(points, a, b, thickness, mat, kind, sign) {
    const group = new THREE.Group();
    jet.add(group);
    group.position.fromArray(a);
    const axis = v(b).sub(v(a)).normalize();
    plate(
      points.map((p) => v(p).sub(v(a)).toArray()),
      thickness,
      mat,
      group,
    );
    rod(a, b, thickness * 0.49, mat);
    moving.push({ group, axis, kind, sign });
    return group;
  }
  for (const side of [-1, 1]) {
    const wing = (points, y = 0.02) => points.map(([x, z]) => [x * side, y, z]);
    plate(
      wing([
        [1.53, -3.65],
        [6.8, 1.88],
        [6.8, 2.76],
        [2, 3.9],
      ]),
      0.1,
      paint,
    );
    // A restrained leading-edge coating and wing panel seam.
    plate(
      wing(
        [
          [1.65, -3.52],
          [6.79, 1.89],
          [6.79, 2.04],
          [1.7, -3.22],
        ],
        0.074,
      ),
      0.006,
      edge,
    );
    line(
      wing(
        [
          [2.3, -1.95],
          [5.94, 1.9],
          [5.97, 2.93],
        ],
        0.078,
      ),
      seam,
      0.01,
    );
    hinge(
      wing([
        [3.54, 3.51],
        [6.8, 2.75],
        [6.8, 3.63],
        [3.72, 4.14],
      ]),
      [3.54 * side, 0.02, 3.51],
      [6.8 * side, 0.02, 2.75],
      0.095,
      secondary,
      'aileron',
      side,
    );
    hinge(
      wing([
        [1.93, 3.92],
        [3.55, 3.51],
        [3.72, 4.14],
        [1.93, 4.64],
      ]),
      [1.93 * side, 0.02, 3.92],
      [3.55 * side, 0.02, 3.51],
      0.095,
      paint,
      'flap',
      side,
    );
    // All-moving tailplanes use a buried spanwise spindle.
    hinge(
      wing(
        [
          [1.45, 5.35],
          [4.47, 7.02],
          [4.69, 8.72],
          [1.67, 8.03],
        ],
        -0.01,
      ),
      [side * 1.52, -0.01, 6.67],
      [side * 3.2, -0.01, 6.67],
      0.12,
      paint,
      'stabilizer',
      side,
    );
    // Canted vertical stabilizers, split along an oblique rudder hinge.
    const fin = new THREE.Group();
    fin.position.set(side * 1.57, 0.29, 4.62);
    fin.rotation.z = -side * 0.39;
    jet.add(fin);
    const finPoints = [
      [0, 0, -0.55],
      [0, 2.69, 1.39],
      [0, 2.69, 2.38],
      [0, 0.09, 2.32],
    ];
    plate(finPoints, 0.115, paint, fin, [1, 0, 0]);
    plate(
      [
        [0, 0.04, -0.5],
        [0, 2.66, 1.4],
        [0, 2.66, 1.55],
        [0, 0.04, -0.31],
      ],
      0.126,
      edge,
      fin,
      [1, 0, 0],
    );
    const rudder = new THREE.Group(),
      origin = [0, 0.09, 2.32],
      end = [0, 2.69, 2.38];
    rudder.position.fromArray(origin);
    fin.add(rudder);
    plate(
      [
        [0, 0.09, 2.32],
        [0, 2.69, 2.38],
        [0, 2.48, 2.97],
        [0, 0.08, 3.54],
      ].map((p) => v(p).sub(v(origin)).toArray()),
      0.112,
      secondary,
      rudder,
      [1, 0, 0],
    );
    rod(origin, end, 0.054, secondary, fin);
    moving.push({
      group: rudder,
      axis: v(end).sub(v(origin)).normalize(),
      kind: 'rudder',
      sign: side,
    });
    // Root fairing covers the fin attachment without protruding through its sides.
    sphere([side * 1.57, 0.27, 5.8], [0.19, 0.2, 1.85], paint);
    // Low-visibility tail identifier, generated locally.
    const label = document.createElement('canvas');
    label.width = 256;
    label.height = 256;
    const ctx = label.getContext('2d');
    ctx.fillStyle = '#4b5961';
    ctx.textAlign = 'center';
    ctx.font = 'bold 70px Arial';
    ctx.fillText('AF', 128, 102);
    ctx.font = '42px monospace';
    ctx.fillText('022', 128, 158);
    const tex = new THREE.CanvasTexture(label);
    tex.colorSpace = THREE.SRGBColorSpace;
    const decal = mesh(
      new THREE.PlaneGeometry(0.66, 0.66),
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
      fin,
    );
    decal.rotation.y = Math.PI / 2;
    decal.position.set(side * 0.061, 1.54, 1.83);
    decal.castShadow = false;
    sphere([side * 6.77, 0.025, 2.37], [0.038, 0.049, 0.16], side < 0 ? red : green);
  }

  // Real four-sided inlet tunnels. The mouth extends outside the chine;
  // the back bends inwards and terminates in a recessed compressor.
  const intakeMouths = [];
  for (const side of [-1, 1]) {
    const rings = [
      [
        [0.94, 0.37, -4.34],
        [1.82, 0.27, -4.02],
        [1.96, -0.52, -3.76],
        [1.04, -0.65, -4.02],
      ],
      [
        [1.13, 0.28, -3.59],
        [1.93, 0.24, -3.43],
        [1.96, -0.46, -3.4],
        [1.12, -0.51, -3.49],
      ],
      [
        [1.14, 0.23, -2.63],
        [1.8, 0.21, -2.63],
        [1.8, -0.39, -2.63],
        [1.14, -0.41, -2.63],
      ],
    ].map((ring) => ring.map(([x, y, z]) => [x * side, y, z]));
    // Outer shell overlaps the hull only behind the opening. No fuselage cap crosses the mouth.
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const wallNormal =
        i === 0 ? [0, 1, 0] : i === 2 ? [0, -1, 0] : [side * (i === 1 ? 1 : -1), 0, 0];
      for (let r = 0; r < 2; r++) {
        const outer = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]].map((p) =>
          v(p).addScaledVector(v(wallNormal), 0.036).toArray(),
        );
        plate(outer, 0.055, paint, jet, wallNormal);
      }
      const geo = new THREE.BufferGeometry();
      const verts = [];
      for (let r = 0; r < 2; r++)
        verts.push(
          ...rings[r][i],
          ...rings[r + 1][i],
          ...rings[r][j],
          ...rings[r][j],
          ...rings[r + 1][i],
          ...rings[r + 1][j],
        );
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      const ductMat = dark;
      ductMat.side = THREE.DoubleSide;
      mesh(geo, ductMat, jet, 'Recessed intake duct');
      rod(rings[0][i], rings[0][j], 0.032, edge);
    }
    plate(rings[2], 0.035, dark, jet, [0, 0, 1]);
    intakeMouths.push(rings[0]);
    const fan = new THREE.Group();
    fan.position.set(side * 1.47, -0.06, -2.66);
    jet.add(fan);
    fans.push(fan);
    sphere([0, 0, 0], [0.075, 0.075, 0.12], titanium, fan);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      rod(
        [Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0],
        [Math.cos(a + 0.27) * 0.28, Math.sin(a + 0.27) * 0.28, 0.045],
        0.017,
        titanium,
        fan,
      );
    }
    // Twin rectangular, articulated exhaust tunnels, with serrated outer petals.
    const exhaust = new THREE.Group();
    exhaust.position.set(side * 1.04, -0.02, 8.02);
    jet.add(exhaust);
    nozzles.push(exhaust);
    box([0, 0, -0.09], [1.69, 0.72, 0.34], titanium, exhaust);
    box([0, 0, 0.35], [1.46, 0.47, 0.028], dark, exhaust);
    box([0, 0, 0.37], [1.19, 0.33, 0.02], glow, exhaust).name = 'Exhaust core';
    for (const s of [-1, 1]) {
      box([s * 0.785, 0, 0.63], [0.07, 0.53, 1.29], titanium, exhaust);
      // Longitudinal grooves on the inner throat.
      for (let i = 0; i < 9; i++)
        rod(
          [-0.65 + i * 0.1625, s * 0.238, 0.18],
          [-0.65 + i * 0.1625, s * 0.187, 1.32],
          0.011,
          dark,
          exhaust,
        );
      const teeth = [
        [-0.8, s * 0.3, -0.1],
        [0.8, s * 0.3, -0.1],
        [0.8, s * 0.2, 1.35],
      ];
      for (let i = 0; i <= 14; i++)
        teeth.push([0.8 - (i * 1.6) / 14, s * 0.2, 1.35 - (i % 2) * 0.1]);
      plate(teeth, 0.05, titanium, exhaust);
      for (let i = 0; i < 11; i++)
        line(
          [
            [-0.72 + i * 0.144, s * 0.33, 0.04],
            [-0.72 + i * 0.144, s * 0.231, 1.22],
          ],
          edge,
          0.007,
          exhaust,
        );
    }
    // Exhaust shoulder fairings join the wing-root and nozzle housing.
    plate(
      [
        [side * 1.9, 0.06, 6.7],
        [side * 2.19, 0.02, 7.8],
        [side * 1.84, 0.01, 8.5],
        [side * 1.7, 0.05, 7.6],
      ],
      0.12,
      secondary,
    );
  }

  // Landing gear wells, inner roofs, hinges, separate linked doors and struts.
  for (const [index, well] of wells.entries()) {
    const { x, z, width, length, roof } = well;
    const lower = surface(x, z, false) - 0.03;
    box([x, roof, z], [width + 0.18, 0.07, length + 0.19], bayMat);
    for (const s of [-1, 1]) {
      box(
        [x + s * (width / 2 + 0.035), (lower + roof) / 2, z],
        [0.08, roof - lower, length + 0.17],
        bayMat,
      );
      box(
        [x, (lower + roof) / 2, z + s * (length / 2 + 0.035)],
        [width + 0.15, roof - lower, 0.09],
        bayMat,
      );
      const door = new THREE.Group();
      door.position.set(x + s * (width / 2 + 0.04), lower - 0.02, z);
      jet.add(door);
      box([-s * (width / 4 + 0.04), 0, 0], [width / 2 + 0.085, 0.055, length + 0.18], paint, door);
      box(
        [-s * (width / 4 + 0.04), 0.033, 0],
        [width / 2 - 0.035, 0.012, length - 0.08],
        bayMat,
        door,
      );
      rod([0, 0, -length / 2], [0, 0, length / 2], 0.036, metal, door);
      doors.push({ group: door, sign: s });
    }
    const gear = new THREE.Group();
    gear.position.set(x, roof - 0.06, z);
    jet.add(gear);
    const wheelRadius = index ? 0.32 : 0.235,
      bottom = -1.45 + wheelRadius,
      wheelY = bottom - gear.position.y;
    const wheelZ = index ? 0.28 : 0.1;
    rod([0, 0.05, 0], [0, wheelY * 0.58, 0.05], 0.073, edge, gear);
    rod([0, wheelY * 0.45, 0.04], [0, wheelY, wheelZ], 0.046, metal, gear);
    rod([0, -0.03, -0.5], [0, wheelY * 0.67, 0.09], 0.041, titanium, gear);
    rod([0, wheelY * 0.55, 0.02], [0.12, wheelY * 0.72, 0.14], 0.025, metal, gear);
    rod([0.12, wheelY * 0.72, 0.14], [0, wheelY * 0.87, 0.18], 0.025, metal, gear);
    rod([-0.19, wheelY, wheelZ], [0.19, wheelY, wheelZ], 0.067, titanium, gear);
    line(
      [
        [0.075, -0.08, 0],
        [0.085, wheelY * 0.5, -0.01],
        [0.07, wheelY * 0.8, 0.1],
        [0.16, wheelY, wheelZ],
      ],
      dark,
      0.014,
      gear,
    );
    const tire = mesh(
      new THREE.TorusGeometry(wheelRadius * 0.76, wheelRadius * 0.24, 12, 32),
      rubber,
      gear,
    );
    tire.rotation.y = Math.PI / 2;
    tire.position.set(index ? Math.sign(x) * 0.1 : 0, wheelY, wheelZ);
    const hub = mesh(
      new THREE.CylinderGeometry(wheelRadius * 0.56, wheelRadius * 0.56, 0.13, 24),
      metal,
      gear,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(tire.position);
    for (const s of [-1, 1]) {
      sphere([tire.position.x + s * 0.072, wheelY, wheelZ], [0.025, 0.07, 0.07], titanium, gear);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        sphere(
          [
            tire.position.x + s * 0.067,
            wheelY + Math.cos(a) * wheelRadius * 0.38,
            wheelZ + Math.sin(a) * wheelRadius * 0.38,
          ],
          [0.013, 0.023, 0.023],
          dark,
          gear,
        );
      }
    }
    if (!index) sphere([0, wheelY * 0.54, -0.075], [0.063, 0.075, 0.045], white, gear);
    landingGear.push({
      group: gear,
      direction: index ? Math.sign(x) : 0,
      wheelY,
      wheelZ,
      radius: wheelRadius,
    });
  }
  // Antennas grow out of the spine, and navigation lamps sit in their fairings.
  for (const [z, size] of [
    [-0.8, 0.27],
    [3.2, 0.2],
  ]) {
    const y = surface(0, z);
    plate(
      [
        [0, y - 0.045, z - 0.2],
        [0, y + size, z + 0.02],
        [0, y + size * 0.55, z + 0.26],
        [0, y - 0.045, z + 0.28],
      ],
      0.045,
      secondary,
      jet,
      [1, 0, 0],
    );
  }
  sphere([0, surface(0, 5.3), 5.3], [0.07, 0.055, 0.12], white);

  const palettes = {
    gray: ['#788691', '#626f7c', '#9ca8ae', '#55636d'],
    arctic: ['#e0e5e2', '#718794', '#bec9cc', '#839096'],
    graphite: ['#424f5b', '#29363f', '#71808b', '#24313a'],
  };
  function setFinish(key) {
    [paint, secondary, edge, seam].forEach((mat, i) => mat.color.set(palettes[key][i]));
  }
  function update({ dt, time, rpm, gear, door, motion, bank, pitch }) {
    for (const part of moving) {
      const angle =
        part.kind === 'aileron'
          ? bank * 1.6
          : part.kind === 'stabilizer'
            ? (pitch * 1.6 + Math.sin(time * 0.7) * 0.018 * motion) * part.sign
            : part.kind === 'rudder'
              ? Math.sin(time * 0.5) * 0.055 * motion
              : 0.08 * motion * part.sign;
      part.group.quaternion.setFromAxisAngle(part.axis, angle);
    }
    nozzles.forEach((part) => {
      part.rotation.x = -pitch * 1.3;
    });
    fans.forEach((fan) => {
      fan.rotation.z = (fan.rotation.z + dt * rpm * 8) % (Math.PI * 2);
    });
    glow.emissiveIntensity = rpm * rpm * 1.9;
    for (const part of landingGear) {
      if (part.direction) part.group.rotation.z = -part.direction * gear * Math.PI * 0.49;
      else part.group.rotation.x = -gear * Math.PI * 0.49;
      part.group.visible = gear < 0.998;
    }
    doors.forEach((part) => {
      part.group.rotation.z = part.sign * door * 1.28;
    });
  }
  return { jet, setFinish, update, hull, intakeMouths, landingGear, nozzles, moving };
}
