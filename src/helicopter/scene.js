import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const viewport = $('viewport');
const fallback = $('fallback');
$('retry').onclick = () => location.reload();

function fail(message) {
  fallback.hidden = false;
  fallback.querySelector('.error-detail').textContent = message;
  $('status').textContent = 'Unavailable';
  document.querySelectorAll('.controls button,.panel button,.panel input').forEach((el) => {
    el.disabled = true;
  });
}

function start() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!context) {
    fail('WebGL 2 is unavailable. Enable hardware acceleration and reload.');
    return;
  }
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  viewport.appendChild(canvas);
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '3D helicopter. Drag or use arrow keys to orbit; scroll or pinch to zoom.',
  );

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8eae9');
  scene.fog = new THREE.Fog('#e8eae9', 45, 100);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 140);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; // Frame-rate-independent smoothing is applied to camera presets below.
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 42;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.86;
  controls.zoomSpeed = 0.7;
  controls.rotateSpeed = 0.65;
  controls.target.set(1.05, 2.05, 0);

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, 0.035);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.7;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf7fcff, 0x7b878e, 1.35));
  const key = new THREE.DirectionalLight(0xfff9ee, 2.4);
  key.position.set(-6, 11, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 35;
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0001;
  key.shadow.radius = 4;
  key.target.position.set(1, 1, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xe4f2ff, 2.0);
  rim.position.set(4, 6, -7);
  scene.add(rim);

  const paint = new THREE.MeshPhysicalMaterial({
    color: '#f2f4f3',
    metalness: 0.27,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.19,
  });
  const navy = new THREE.MeshPhysicalMaterial({
    color: '#193249',
    metalness: 0.4,
    roughness: 0.28,
    clearcoat: 0.8,
  });
  const blue = new THREE.MeshPhysicalMaterial({
    color: '#378fb7',
    metalness: 0.45,
    roughness: 0.24,
    clearcoat: 1,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#122c3a',
    metalness: 0.55,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.65,
    side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141d24', roughness: 0.64 });
  const seam = new THREE.MeshStandardMaterial({ color: '#5e6b70', metalness: 0.3, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({
    color: '#9aa5aa',
    metalness: 0.88,
    roughness: 0.25,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: '#29333b',
    metalness: 0.7,
    roughness: 0.32,
  });
  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: '#25313a',
    metalness: 0.5,
    roughness: 0.36,
    clearcoat: 0.4,
  });
  const warmMetal = new THREE.MeshStandardMaterial({
    color: '#807669',
    metalness: 0.9,
    roughness: 0.35,
  });
  const white = new THREE.MeshStandardMaterial({
    color: '#e4e9e7',
    roughness: 0.38,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const helicopter = new THREE.Group();
  helicopter.name = 'Horizon 05 connected airframe';
  const groundOffset = 0.24 - (0.09 - 0.083); // Platform top minus skid centre/radius.
  helicopter.position.y = groundOffset;
  scene.add(helicopter);
  const unitSphere = new THREE.SphereGeometry(1, 28, 18);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
  function mesh(geometry, material, parent = helicopter) {
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function ellipsoid(position, scale, material, parent = helicopter) {
    const object = mesh(unitSphere, material, parent);
    object.position.set(...position);
    object.scale.set(...scale);
    return object;
  }
  function box(position, scale, material, parent = helicopter) {
    const object = mesh(unitBox, material, parent);
    object.position.set(...position);
    object.scale.set(...scale);
    return object;
  }
  function rod(a, b, radius, material, parent = helicopter) {
    const p = new THREE.Vector3(...a),
      q = new THREE.Vector3(...b);
    const object = mesh(unitCylinder, material, parent);
    object.position.copy(p).add(q).multiplyScalar(0.5);
    object.scale.set(radius, p.distanceTo(q), radius);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.sub(p).normalize());
    return object;
  }
  function tube(points, radius, material, parent = helicopter, closed = false, smooth = true) {
    const curve = smooth
      ? new THREE.CatmullRomCurve3(
          points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))),
          closed,
          'centripetal',
        )
      : new THREE.CurvePath();
    if (!smooth)
      for (let i = 1; i < points.length; i++)
        curve.add(new THREE.LineCurve3(points[i - 1], points[i]));
    return mesh(
      new THREE.TubeGeometry(curve, Math.max(24, points.length * 3), radius, 6, closed),
      material,
      parent,
    );
  }
  function solidShape(points, depth, material, parent = helicopter, bevel = 0.03) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 3,
      steps: 1,
    });
    geometry.translate(0, 0, -depth / 2);
    return mesh(geometry, material, parent);
  }

  // A single continuous loft: x, centre height, vertical radius, lateral radius.
  const stations = [
    [-3.28, 1.8, 0.025, 0.025],
    [-3.12, 1.88, 0.36, 0.42],
    [-2.78, 1.99, 0.64, 0.77],
    [-2.2, 2.12, 0.9, 1.04],
    [-1.4, 2.16, 1.06, 1.16],
    [-0.3, 2.15, 1.13, 1.18],
    [0.9, 2.15, 1.07, 1.12],
    [1.65, 2.19, 0.82, 0.86],
    [2.35, 2.27, 0.46, 0.48],
    [2.8, 2.3, 0.28, 0.29],
  ];
  function profile(x) {
    let i = 0;
    while (i < stations.length - 2 && x > stations[i + 1][0]) i++;
    const a = stations[i],
      b = stations[i + 1],
      prev = stations[Math.max(0, i - 1)],
      next = stations[Math.min(stations.length - 1, i + 2)];
    const t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1),
      h = b[0] - a[0];
    return [1, 2, 3].map((k) => {
      const m0 = (b[k] - prev[k]) / (b[0] - prev[0]),
        m1 = (next[k] - a[k]) / (next[0] - a[0]);
      return (
        (2 * t * t * t - 3 * t * t + 1) * a[k] +
        (t * t * t - 2 * t * t + t) * h * m0 +
        (-2 * t * t * t + 3 * t * t) * b[k] +
        (t * t * t - t * t) * h * m1
      );
    });
  }
  function skin(x, angle, offset = 0) {
    const [cy, ry, rz] = profile(x);
    return new THREE.Vector3(
      x,
      cy + (ry + offset) * Math.cos(angle),
      (rz + offset) * Math.sin(angle),
    );
  }
  function parametric(fn, uCount, vCount, material, parent = helicopter) {
    const positions = [],
      indices = [];
    for (let i = 0; i <= uCount; i++)
      for (let j = 0; j <= vCount; j++) positions.push(...fn(i / uCount, j / vCount).toArray());
    for (let i = 0; i < uCount; i++)
      for (let j = 0; j < vCount; j++) {
        const a = i * (vCount + 1) + j,
          b = a + vCount + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(geometry, material, parent);
  }
  const fuselage = parametric((u, v) => skin(mix(-3.28, 2.8, u), v * TAU), 100, 80, paint);
  fuselage.name = 'Continuous fuselage';
  // Conformal paint bands share the same analytic surface as the hull.
  parametric((u, v) => skin(mix(-3.25, 2.75, u), mix(1.94, TAU - 1.94, v), 0.007), 100, 44, navy);
  for (const side of [-1, 1]) {
    parametric(
      (u, v) => skin(mix(-3.19, 2.77, u), side * (mix(1.77, 1.91, v) - 0.12 * u), 0.014),
      90,
      4,
      blue,
    );
    parametric(
      (u, v) => skin(mix(-3.17, 2.77, u), side * (mix(1.94, 1.975, v) - 0.12 * u), 0.016),
      90,
      2,
      white,
    );
  }

  const rivets = [];
  function rivet(position) {
    rivets.push(position);
  }
  function mapping(corners, u, v, offset = 0.018) {
    const x = mix(mix(corners[0][0], corners[1][0], u), mix(corners[3][0], corners[2][0], u), v);
    const a = mix(mix(corners[0][1], corners[1][1], u), mix(corners[3][1], corners[2][1], u), v);
    return skin(x, a, offset);
  }
  // Rounded glazing is tessellated BEFORE projection, fitting the curved skin
  // everywhere, including the interior of each pane. Seals intersect the hull.
  function windowPane(corners) {
    const shape = new THREE.Shape(),
      r = 0.11;
    shape.moveTo(r, 0);
    shape.lineTo(1 - r, 0);
    shape.quadraticCurveTo(1, 0, 1, r);
    shape.lineTo(1, 1 - r);
    shape.quadraticCurveTo(1, 1, 1 - r, 1);
    shape.lineTo(r, 1);
    shape.quadraticCurveTo(0, 1, 0, 1 - r);
    shape.lineTo(0, r);
    shape.quadraticCurveTo(0, 0, r, 0);
    const outline = shape.getPoints(7),
      faces = THREE.ShapeUtils.triangulateShape(outline, []),
      positions = [],
      normals = [];
    function add(uv) {
      const p = mapping(corners, uv.x, uv.y, 0.011);
      const du = mapping(corners, uv.x + 0.001, uv.y, 0.011).sub(p),
        dv = mapping(corners, uv.x, uv.y + 0.001, 0.011).sub(p);
      const normal = du.cross(dv).normalize();
      positions.push(...p.toArray());
      normals.push(...normal.toArray());
    }
    for (const face of faces) {
      const a = outline[face[0]],
        b = outline[face[1]],
        c = outline[face[2]],
        n = 12;
      const pt = (i, j) =>
        new THREE.Vector2()
          .copy(a)
          .multiplyScalar(1 - (i + j) / n)
          .addScaledVector(b, i / n)
          .addScaledVector(c, j / n);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n - i; j++) {
          add(pt(i, j));
          add(pt(i + 1, j));
          add(pt(i, j + 1));
          if (j < n - i - 1) {
            add(pt(i + 1, j));
            add(pt(i + 1, j + 1));
            add(pt(i, j + 1));
          }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const pane = mesh(geometry, glass);
    pane.name = 'Flush curved glazing';
    pane.castShadow = false;
    tube(
      outline.map((p) => mapping(corners, p.x, p.y, 0.014)),
      0.027,
      rubber,
      helicopter,
      true,
    );
  }
  for (const side of [-1, 1]) {
    const uv = (points) => points.map(([x, a]) => [x, a * side]);
    windowPane(
      uv([
        [-3.06, 0.1],
        [-1.46, 0.24],
        [-1.52, 1.43],
        [-3.06, 1.47],
      ]),
    );
    windowPane(
      uv([
        [-1.32, 0.47],
        [-0.24, 0.54],
        [-0.24, 1.48],
        [-1.34, 1.48],
      ]),
    );
    windowPane(
      uv([
        [-0.05, 0.6],
        [1.26, 0.67],
        [1.33, 1.49],
        [-0.05, 1.49],
      ]),
    );
    // Door edges and tracks lie on the same surface; handles have two feet.
    for (const [front, rear, top] of [
      [-1.42, -0.15, 0.4],
      [-0.12, 1.49, 0.53],
    ]) {
      const outline = [];
      for (let i = 0; i <= 16; i++) outline.push(skin(mix(front, rear, i / 16), side * top, 0.021));
      for (let i = 1; i <= 22; i++) outline.push(skin(rear, side * mix(top, 2.26, i / 22), 0.021));
      for (let i = 1; i <= 16; i++)
        outline.push(skin(mix(rear, front, i / 16), side * 2.26, 0.021));
      for (let i = 1; i <= 22; i++) outline.push(skin(front, side * mix(2.26, top, i / 22), 0.021));
      tube(outline, 0.009, seam, helicopter, true);
      const handleX = rear - 0.24,
        a = skin(handleX - 0.1, side * 1.67, 0.03),
        b = skin(handleX + 0.1, side * 1.67, 0.03);
      const aa = a.clone().add(new THREE.Vector3(0, 0, side * 0.065)),
        bb = b.clone().add(new THREE.Vector3(0, 0, side * 0.065));
      rod(a.toArray(), aa.toArray(), 0.024, metal);
      rod(b.toArray(), bb.toArray(), 0.024, metal);
      rod(aa.toArray(), bb.toArray(), 0.031, darkMetal);
      for (let i = 0; i < 11; i++)
        rivet(skin(mix(front + 0.08, rear - 0.08, i / 10), side * 2.2, 0.025));
    }
    tube(
      Array.from({ length: 25 }, (_, i) => skin(mix(-0.06, 1.68, i / 24), side * 0.48, 0.035)),
      0.022,
      metal,
    );
    for (const x of [-1.42, -0.12, 1.5])
      for (let i = 0; i < 8; i++) rivet(skin(x, side * mix(0.5, 2.15, i / 7), 0.028));
    // Windshield wipers stay against the curved panes.
    tube(
      [
        skin(-2.72, side * 1.43, 0.05),
        skin(-2.47, side * 1.03, 0.05),
        skin(-2.15, side * 0.77, 0.05),
      ],
      0.015,
      darkMetal,
    );
    tube([skin(-2.43, side * 0.88, 0.059), skin(-2.03, side * 0.72, 0.059)], 0.025, rubber);
  }
  ellipsoid([-3.16, 1.58, 0], [0.15, 0.09, 0.22], darkMetal);
  const lampMat = new THREE.MeshPhysicalMaterial({
    color: '#e8f5fd',
    emissive: '#c4e4fa',
    emissiveIntensity: 0.3,
    roughness: 0.12,
    metalness: 0.25,
  });
  for (const z of [-0.15, 0.15]) ellipsoid([-3.205, 1.6, z], [0.038, 0.055, 0.062], lampMat);

  // Tail boom continues through the aft fuselage and into the duct's lower rim.
  const tailBoom = parametric(
    (u, v) => {
      const x = mix(1.86, 6.27, u),
        radius = mix(0.57, 0.19, u),
        cy = mix(2.26, 2.42, u);
      return new THREE.Vector3(
        x,
        cy + radius * Math.cos(v * TAU),
        radius * 0.86 * Math.sin(v * TAU),
      );
    },
    65,
    40,
    paint,
  );
  tailBoom.name = 'Connected tapered tail boom';
  for (const side of [-1, 1])
    parametric(
      (u, v) => {
        const radius = mix(0.57, 0.19, u) + 0.009,
          a = side * mix(1.45, 1.74, v);
        return new THREE.Vector3(
          mix(1.86, 6.27, u),
          mix(2.26, 2.42, u) + radius * Math.cos(a),
          radius * 0.86 * Math.sin(a),
        );
      },
      40,
      3,
      blue,
    );
  for (const x of [3.05, 4.5, 5.75]) {
    const u = (x - 1.86) / (6.27 - 1.86),
      r = mix(0.57, 0.19, u) + 0.008,
      cy = mix(2.26, 2.42, u);
    tube(
      Array.from({ length: 49 }, (_, i) => [
        x,
        cy + r * Math.cos((i / 48) * TAU),
        r * 0.86 * Math.sin((i / 48) * TAU),
      ]),
      0.009,
      seam,
      helicopter,
      true,
    );
  }
  const stabilizer = solidShape(
    [
      [4.78, 0],
      [5.62, 0],
      [5.87, 2.12],
      [5.36, 2.24],
    ],
    0.105,
    paint,
  );
  stabilizer.rotation.x = Math.PI / 2;
  stabilizer.position.y = 2.41;
  const stabilizer2 = stabilizer.clone();
  stabilizer2.rotation.x = -Math.PI / 2;
  helicopter.add(stabilizer2);
  for (const side of [-1, 1]) {
    const winglet = solidShape(
      [
        [5.34, 2.27],
        [5.92, 2.28],
        [5.83, 2.94],
        [5.6, 2.96],
      ],
      0.07,
      navy,
    );
    winglet.position.z = side * 2.15;
  }

  const ductCenter = new THREE.Vector3(7.02, 3.0, 0),
    ductOuter = 1.03,
    ductInner = 0.7;
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, ductOuter, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, ductInner, 0, TAU, true);
  ringShape.holes.push(hole);
  const ringGeometry = new THREE.ExtrudeGeometry(ringShape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.085,
    bevelSize: 0.065,
    bevelSegments: 4,
    curveSegments: 64,
    steps: 1,
  });
  ringGeometry.translate(0, 0, -0.17);
  const duct = mesh(ringGeometry, paint);
  duct.position.copy(ductCenter);
  duct.name = 'Open tail rotor duct';
  const innerWall = mesh(new THREE.CylinderGeometry(0.702, 0.702, 0.34, 64, 1, true), darkMetal);
  innerWall.rotation.x = Math.PI / 2;
  innerWall.position.copy(ductCenter);
  for (const side of [-1, 1]) {
    const lip = mesh(new THREE.TorusGeometry(0.74, 0.025, 8, 80), navy);
    lip.position.copy(ductCenter);
    lip.position.z = side * 0.227;
    for (let i = 0; i < 16; i++)
      rivet(
        new THREE.Vector3(
          7.02 + 0.89 * Math.cos((i / 16) * TAU),
          3 + 0.89 * Math.sin((i / 16) * TAU),
          side * 0.253,
        ),
      );
  }
  const upperFin = solidShape(
    [
      [6.25, 3.42],
      [6.63, 4.0],
      [7.14, 5.03],
      [7.78, 5.08],
      [7.94, 4.85],
      [7.77, 3.51],
      [7.6, 3.85],
      [7.02, 3.98],
      [6.53, 3.85],
    ],
    0.25,
    paint,
  );
  solidShape(
    [
      [6.92, 4.46],
      [7.2, 4.98],
      [7.72, 5.02],
      [7.86, 4.84],
      [7.7, 4.5],
    ],
    0.266,
    blue,
  );
  const lowerFin = solidShape(
    [
      [6.51, 2.22],
      [6.86, 1.51],
      [7.55, 1.4],
      [7.73, 2.22],
    ],
    0.23,
    navy,
  );
  // Three stationary stator arms attach the gearbox to the duct behind the rotor.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    rod(
      [7.02, 3, 0.13],
      [7.02 + 0.74 * Math.cos(a), 3 + 0.74 * Math.sin(a), 0.13],
      0.041,
      darkMetal,
    );
  }
  const tailRotor = new THREE.Group();
  tailRotor.position.copy(ductCenter);
  helicopter.add(tailRotor);
  rod([0, 0, -0.25], [0, 0, 0.19], 0.15, metal, tailRotor);
  ellipsoid([0, 0, -0.22], [0.18, 0.18, 0.11], navy, tailRotor);
  const tailBladeGeo = new THREE.BoxGeometry(0.46, 0.082, 0.026);
  tailBladeGeo.translate(0.375, 0, 0);
  for (let i = 0; i < 10; i++) {
    const blade = mesh(tailBladeGeo, bladeMat, tailRotor);
    blade.rotation.z = (i / 10) * TAU;
    blade.position.z = -0.06;
  }

  // Curved one-piece skids with transverse tubes passing into belly hardpoints.
  for (const side of [-1, 1]) {
    const z = side * 1.43;
    tube(
      [
        [-2.63, 0.57, z],
        [-2.5, 0.27, z],
        [-2.13, 0.105, z],
        [-1.5, 0.09, z],
        [1.59, 0.09, z],
        [2.13, 0.15, z],
      ],
      0.083,
      metal,
    );
    for (const x of [-1.5, 1.16]) {
      tube(
        [
          [x, 0.17, z],
          [x, 0.31, z * 0.94],
          [x, 0.98, side * 0.94],
          [x, 1.45, side * 0.63],
        ],
        0.078,
        navy,
      );
      ellipsoid([x, 1.31, side * 0.67], [0.19, 0.12, 0.22], navy);
      rod([x - 0.12, 0.16, z], [x + 0.12, 0.16, z], 0.105, darkMetal);
    }
    for (const x of [-0.95, 0.65]) {
      rod([x, 1.43, side * 0.78], [x, 0.67, side * 1.5], 0.036, metal);
      rod([x, 0.67, side * 1.5], [x + 0.39, 0.67, side * 1.5], 0.042, darkMetal);
      rod([x + 0.39, 0.67, side * 1.5], [x + 0.39, 1.43, side * 0.78], 0.036, metal);
      box([x + 0.19, 0.685, side * 1.5], [0.42, 0.035, 0.15], rubber);
    }
  }

  // Twin engine nacelles, intake lips, slatted intake faces and hollow exhausts.
  for (const side of [-1, 1]) {
    const z = side * 0.58;
    ellipsoid([0.49, 3.13, z], [1.39, 0.4, 0.43], paint);
    ellipsoid([-0.75, 3.18, z], [0.15, 0.25, 0.3], rubber);
    const intakeLip = mesh(new THREE.TorusGeometry(0.25, 0.027, 8, 40), metal);
    intakeLip.rotation.y = Math.PI / 2;
    intakeLip.position.set(-0.82, 3.19, z);
    intakeLip.scale.y = 0.86;
    for (let i = -3; i <= 3; i++)
      rod(
        [-0.855, 3.02 + i * 0.05, z - 0.17],
        [-0.855, 3.02 + i * 0.05, z + 0.17],
        0.012,
        darkMetal,
      );
    for (let i = 0; i < 10; i++) {
      const x = 0.14 + i * 0.112;
      box([x, 3.3, side * 0.951], [0.051, 0.22, 0.017], darkMetal).rotation.x = side * 0.31;
    }
    const exhaust = mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.49, 32, 1, true), warmMetal);
    exhaust.rotation.z = -Math.PI / 2;
    exhaust.position.set(1.79, 3.17, z);
    const exhaustInside = mesh(new THREE.CylinderGeometry(0.153, 0.163, 0.45, 32, 1, true), rubber);
    exhaustInside.rotation.z = -Math.PI / 2;
    exhaustInside.position.set(1.8, 3.17, z);
    exhaustInside.material.side = THREE.DoubleSide;
    const end = mesh(new THREE.CircleGeometry(0.163, 32), rubber);
    end.rotation.y = Math.PI / 2;
    end.position.set(1.91, 3.17, z);
    const exhaustRim = mesh(new THREE.TorusGeometry(0.18, 0.024, 8, 32), metal);
    exhaustRim.rotation.y = Math.PI / 2;
    exhaustRim.position.set(2.035, 3.17, z);
  }
  ellipsoid([-0.05, 3.28, 0], [0.72, 0.26, 0.4], navy);
  rod([0, 3.25, 0], [0, 4.18, 0], 0.112, metal);
  rod([0, 3.41, 0], [0, 3.65, 0], 0.23, darkMetal);
  rod([0, 3.77, 0], [0, 3.9, 0], 0.29, metal);
  const swash = mesh(new THREE.TorusGeometry(0.29, 0.048, 8, 40), darkMetal);
  swash.rotation.x = Math.PI / 2;
  swash.position.y = 3.81;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    rod(
      [0.28 * Math.cos(a), 3.35, 0.28 * Math.sin(a)],
      [0.28 * Math.cos(a), 3.81, 0.28 * Math.sin(a)],
      0.025,
      metal,
    );
  }
  const mainRotor = new THREE.Group();
  mainRotor.position.y = 4.22;
  mainRotor.rotation.y = 0.17;
  helicopter.add(mainRotor);
  mainRotor.name = 'Five-blade articulated main rotor';
  rod([0, -0.07, 0], [0, 0.13, 0], 0.24, darkMetal, mainRotor);
  ellipsoid([0, 0.13, 0], [0.29, 0.13, 0.29], metal, mainRotor);
  // Blade sections are tapered, swept and have an airfoil-like thickness.
  function makeBlade() {
    const positions = [],
      indices = [],
      sections = [
        [0.62, 0.14, 0],
        [1.1, 0.23, 0],
        [3.9, 0.205, 0.015],
        [4.92, 0.16, 0.13],
        [5.45, 0.11, 0.28],
      ];
    const sectionProfile = [
      [-1, 0],
      [-0.68, 0.055],
      [0.15, 0.063],
      [1, 0],
      [0.1, -0.025],
      [-0.68, -0.025],
    ];
    for (const [r, chord, sweep] of sections)
      for (const [s, h] of sectionProfile)
        positions.push(r, h + (r - 0.6) * 0.012, s * chord + sweep);
    for (let i = 0; i < sections.length - 1; i++)
      for (let j = 0; j < 6; j++) {
        const a = i * 6 + j,
          b = i * 6 + ((j + 1) % 6),
          c = a + 6,
          d = b + 6;
        indices.push(a, b, c, b, d, c);
      }
    indices.push(24, 25, 26, 24, 26, 27, 24, 27, 28, 24, 28, 29);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
  const bladeGeometry = makeBlade();
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 5) * TAU;
    mainRotor.add(arm);
    rod([0.12, 0, 0], [0.91, 0, 0], 0.075, metal, arm);
    box([0.51, 0, 0], [0.28, 0.14, 0.21], darkMetal, arm);
    rod([0.52, -0.12, 0], [0.52, 0.14, 0], 0.045, metal, arm);
    ellipsoid([0.52, 0.145, 0], [0.069, 0.026, 0.069], metal, arm);
    rod([0.25, -0.4, 0.09], [0.73, -0.02, 0.16], 0.024, metal, arm);
    rod([0.69, -0.02, 0], [0.74, -0.02, 0.2], 0.042, darkMetal, arm);
    const blade = mesh(bladeGeometry, bladeMat, arm);
    blade.name = 'Main rotor blade ' + (i + 1);
    box([5.2, 0.058, 0.216], [0.2, 0.017, 0.25], white, arm).rotation.y = -0.12;
    box([1.03, 0.052, 0], [0.08, 0.013, 0.37], metal, arm);
  }

  // Antennas and navigation lights have visible bases fixed into their panels.
  for (const [x, y, z, tilt] of [
    [1.52, 2.99, 0, 0.2],
    [-0.87, 3.18, 0, -0.18],
  ]) {
    ellipsoid([x, y, z], [0.14, 0.07, 0.13], navy);
    rod([x, y, z], [x + tilt, y + 0.46, z], 0.017, darkMetal);
  }
  rod([1.53, 1.55, 0], [1.76, 0.92, 0], 0.022, darkMetal);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: '#c32e22',
    emissive: '#ff351c',
    emissiveIntensity: 0,
    roughness: 0.18,
  });
  ellipsoid([7.46, 5.12, 0], [0.11, 0.065, 0.11], darkMetal);
  ellipsoid([7.46, 5.19, 0], [0.083, 0.09, 0.083], beaconMat);
  for (const side of [-1, 1]) {
    const p = skin(0.96, side * 1.47, 0.02);
    ellipsoid(p.toArray(), [0.15, 0.09, 0.1], navy);
    const mat = new THREE.MeshStandardMaterial({
      color: side === 1 ? '#df352c' : '#33b98b',
      emissive: side === 1 ? '#fc2417' : '#18e09d',
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    p.z += side * 0.076;
    ellipsoid(p.toArray(), [0.083, 0.047, 0.056], mat);
  }
  const fasteners = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.018, 8, 6),
    metal,
    rivets.length,
  );
  const matrix = new THREE.Matrix4();
  rivets.forEach((p, i) => {
    matrix.makeTranslation(p.x, p.y, p.z);
    fasteners.setMatrixAt(i, matrix);
  });
  helicopter.add(fasteners);

  // Small painted markings use locally generated canvas textures, never assets.
  function decal(text, x, y, z, side, width) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = '500 78px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#254257';
    ctx.fillText(text, 512, 66);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const object = mesh(new THREE.PlaneGeometry(width, width / 8), material);
    object.position.set(x, y, z);
    object.rotation.y = side === 1 ? 0 : Math.PI;
    object.castShadow = false;
  }
  for (const side of [-1, 1]) decal('H O R I Z O N', 0.39, 1.9, side * 1.132, side, 0.83);

  const platformMat = new THREE.MeshStandardMaterial({
    color: '#d8dedd',
    metalness: 0.25,
    roughness: 0.45,
  });
  const platform = mesh(new THREE.CylinderGeometry(6.8, 6.9, 0.24, 128), platformMat, scene);
  platform.position.set(1.1, 0.12, 0);
  const edge = mesh(new THREE.TorusGeometry(6.79, 0.012, 6, 160), metal, scene);
  edge.rotation.x = Math.PI / 2;
  edge.position.set(1.1, 0.245, 0);
  const platformLine = mesh(new THREE.TorusGeometry(6.32, 0.007, 4, 128), seam, scene);
  platformLine.rotation.x = Math.PI / 2;
  platformLine.position.set(1.1, 0.245, 0);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU,
      r = 6.49;
    const tick = box(
      [1.1 + r * Math.cos(a), 0.246, r * Math.sin(a)],
      [i % 5 === 0 ? 0.13 : 0.055, 0.003, 0.012],
      seam,
      scene,
    );
    tick.rotation.y = -a;
  }
  const floor = mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
    scene,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.014;
  floor.castShadow = false;

  let running = false,
    hover = false,
    auto = false,
    speed = 0.7,
    rpm = 0,
    altitude = 0,
    elapsed = 0,
    last = performance.now(),
    lost = false,
    frame = 0;
  let cameraGoal = null,
    homeDistance = 25;
  const homeDirection = new THREE.Vector3(-0.82, 0.46, 1.13).normalize();
  function fittedDistance() {
    const vfov = THREE.MathUtils.degToRad(camera.fov),
      hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const radius = camera.aspect > 1.3 ? 6.05 : 7.25;
    return Math.max(18, radius / Math.sin(Math.min(vfov, hfov) / 2));
  }
  function view(direction, immediate = false) {
    auto = false;
    $('auto').setAttribute('aria-pressed', 'false');
    const target = new THREE.Vector3(1.05, 2.05, 0),
      position = direction.clone().normalize().multiplyScalar(homeDistance).add(target);
    if (immediate || reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      cameraGoal = null;
      controls.update();
    } else cameraGoal = { position, target };
  }
  function resize() {
    const w = viewport.clientWidth,
      h = viewport.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const old = homeDistance;
    homeDistance = fittedDistance();
    controls.maxDistance = Math.max(42, homeDistance * 1.65);
    if (old !== homeDistance)
      camera.position
        .sub(controls.target)
        .multiplyScalar(homeDistance / old)
        .add(controls.target);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  view(homeDirection, true);
  controls.addEventListener('start', () => {
    cameraGoal = null;
    auto = false;
    $('auto').setAttribute('aria-pressed', 'false');
  });
  let noticeUntil = 0;
  function notice(text) {
    $('notice').textContent = text;
    noticeUntil = elapsed + 5;
  }
  function sync() {
    $('rotors').innerHTML = running ? 'Ⅱ &nbsp; Stop rotors' : '▷ &nbsp; Start rotors';
    $('rotors').setAttribute('aria-pressed', String(running));
    $('hover').setAttribute('aria-pressed', String(hover));
    $('hover').innerHTML = hover ? '↓ &nbsp; Land' : '↑ &nbsp; Hover';
  }
  function toggleRotors() {
    running = !running;
    if (!running) {
      hover = false;
      notice(altitude > 0.03 ? 'Landing softly before rotor shutdown.' : 'Rotors slowing to rest.');
    } else notice('Both rotors starting.');
    sync();
  }
  function toggleHover() {
    hover = !hover;
    if (hover) {
      running = true;
      if (speed < 0.55) {
        speed = 0.7;
        $('speed').value = '70';
        $('speed-value').textContent = '70%';
      }
      notice('Spooling up for a gentle lift-off.');
    } else notice('Returning to the platform.');
    sync();
  }
  $('rotors').onclick = toggleRotors;
  $('hover').onclick = toggleHover;
  $('auto').onclick = () => {
    auto = !auto;
    cameraGoal = null;
    $('auto').setAttribute('aria-pressed', String(auto));
  };
  $('reset').onclick = () => view(homeDirection);
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () =>
      view(
        {
          front: new THREE.Vector3(-1, 0.19, 0),
          side: new THREE.Vector3(0, 0.17, 1),
          tail: new THREE.Vector3(1, 0.21, 0),
        }[button.dataset.view],
      );
  });
  $('speed').oninput = () => {
    speed = Number($('speed').value) / 100;
    $('speed-value').textContent = Math.round(speed * 100) + '%';
    if (speed < 0.55 && hover) {
      hover = false;
      notice('Rotor speed is below lift power. Landing softly.');
      sync();
    }
  };
  const liveries = {
    glacier: ['#f2f4f3', '#193249', '#378fb7', 'Glacier blue & white'],
    rescue: ['#ee6529', '#27323a', '#f0e9d8', 'Rescue orange'],
    graphite: ['#4c5861', '#17212b', '#a9b6bd', 'Graphite'],
  };
  let livery = 'glacier';
  document.querySelectorAll('[data-livery]').forEach((button) => {
    button.onclick = () => {
      livery = button.dataset.livery;
      const colors = liveries[livery];
      paint.color.set(colors[0]);
      navy.color.set(colors[1]);
      blue.color.set(colors[2]);
      $('livery-name').textContent = colors[3];
      document
        .querySelectorAll('[data-livery]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    };
  });
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else notice('Fullscreen is unavailable in this browser.');
    } catch {
      notice('Fullscreen was blocked. Open this page in its own browser tab and try again.');
    }
  };
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').setAttribute(
      'aria-label',
      document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen',
    );
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,button,a') || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRotors();
    }
    if (e.code === 'KeyH') toggleHover();
    if (e.code === 'KeyR') view(homeDirection);
    if (e.target === canvas && e.code.startsWith('Arrow')) {
      e.preventDefault();
      cameraGoal = null;
      auto = false;
      $('auto').setAttribute('aria-pressed', 'false');
      const offset = camera.position.clone().sub(controls.target),
        s = new THREE.Spherical().setFromVector3(offset);
      if (e.code === 'ArrowLeft') s.theta -= 0.12;
      if (e.code === 'ArrowRight') s.theta += 0.12;
      if (e.code === 'ArrowUp') s.phi -= 0.1;
      if (e.code === 'ArrowDown') s.phi += 0.1;
      s.phi = clamp(s.phi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      controls.update();
    }
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    notice('Graphics paused. Waiting for the renderer to recover.');
    $('status').textContent = 'Graphics paused';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    last = performance.now();
    notice('Graphics restored.');
  });
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  function animate(now) {
    frame = requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (document.hidden || lost) return;
    elapsed += dt;
    if (noticeUntil && elapsed >= noticeUntil) {
      $('notice').textContent = '';
      noticeUntil = 0;
    }
    // Keep lift power while landing, even if Stop or zero speed was requested.
    const targetRPM = altitude > 0.015 && !hover ? Math.max(speed, 0.58) : running ? speed : 0;
    const previousRPM = rpm;
    rpm += (targetRPM - rpm) * (1 - Math.exp(-dt / (targetRPM > rpm ? 1.6 : 2.0)));
    if (targetRPM === 0 && rpm < 0.001) rpm = 0;
    const angle = (rpm + previousRPM) * 0.5 * TAU * 6.4 * dt;
    mainRotor.rotation.y = (mainRotor.rotation.y + angle) % TAU;
    tailRotor.rotation.z = (tailRotor.rotation.z - angle * 4.7) % TAU;
    const targetAltitude = hover && rpm > 0.46 ? 1.65 : 0;
    altitude +=
      (targetAltitude - altitude) * (1 - Math.exp(-dt * (targetAltitude > altitude ? 0.82 : 1.25)));
    if (!hover && altitude < 0.003) altitude = 0;
    const motion = reducedMotion ? 0 : altitude / 1.65;
    helicopter.position.y = groundOffset + altitude + Math.sin(elapsed * 1.1) * 0.045 * motion;
    helicopter.rotation.z = Math.sin(elapsed * 0.72) * 0.011 * motion;
    helicopter.rotation.x = Math.sin(elapsed * 0.95) * 0.012 * motion;
    beaconMat.emissiveIntensity = reducedMotion
      ? 0.3
      : elapsed % 1.4 < 0.1 || (elapsed % 1.4 > 0.2 && elapsed % 1.4 < 0.29)
        ? 4
        : 0.08;
    if (cameraGoal) {
      const a = 1 - Math.exp(-dt * 5);
      camera.position.lerp(cameraGoal.position, a);
      controls.target.lerp(cameraGoal.target, a);
      if (camera.position.distanceTo(cameraGoal.position) < 0.006) {
        camera.position.copy(cameraGoal.position);
        controls.target.copy(cameraGoal.target);
        cameraGoal = null;
      }
    }
    if (auto) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.15);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
    renderer.render(scene, camera);
    const state =
      altitude > 0.03
        ? hover
          ? 'Hovering'
          : 'Landing'
        : hover
          ? rpm > 0.46
            ? 'Lifting off'
            : 'Spooling up'
          : rpm > 0.015
            ? running
              ? Math.abs(rpm - speed) > 0.04
                ? rpm < speed
                  ? 'Spooling up'
                  : 'Spooling down'
                : 'Rotors active'
              : 'Spooling down'
            : 'On platform';
    if ($('status').textContent !== state) $('status').textContent = state;
    $('telemetry').textContent =
      String(Math.round(rpm * 384)).padStart(3, '0') + ' RPM  /  ' + altitude.toFixed(1) + ' M';
  }
  sync();
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
  // Opt-in, read-only diagnostics for regression tests, absent in normal use.
  if (new URLSearchParams(location.search).has('inspect')) {
    // Cast through the rotor's swept aperture, excluding its intentional hub
    // and stator arms. This catches a fin or boom accidentally sealing the hole.
    const ray = new THREE.Raycaster();
    let blockedApertureSamples = 0;
    for (const radius of [0.25, 0.45, 0.62])
      for (let i = 0; i < 36; i++) {
        const point = new THREE.Vector3(
          7.02 + radius * Math.cos((i / 36) * TAU),
          3 + radius * Math.sin((i / 36) * TAU),
          -1,
        );
        ray.set(helicopter.localToWorld(point), new THREE.Vector3(0, 0, 1));
        if (ray.intersectObjects([tailBoom, upperFin, lowerFin, duct, innerWall], false).length)
          blockedApertureSamples++;
      }
    window.horizonDiagnostics = () => ({
      running,
      hover,
      auto,
      speed,
      rpm,
      altitude,
      livery,
      mainAngle: mainRotor.rotation.y,
      tailAngle: tailRotor.rotation.z,
      camera: camera.position.toArray(),
      target: controls.target.toArray(),
      pixelRatio: renderer.getPixelRatio(),
      triangles: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      blockedApertureSamples,
      rotorBounds: Array.from({ length: 40 }, (_, i) =>
        new THREE.Vector3(
          5.5 * Math.cos((i / 40) * TAU),
          4.32 + groundOffset,
          5.5 * Math.sin((i / 40) * TAU),
        )
          .project(camera)
          .toArray(),
      ),
      duct: { innerRadius: ductInner, outerRadius: ductOuter },
    });
  }
  addEventListener('pagehide', (event) => {
    cancelAnimationFrame(frame);
    if (!event.persisted) {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      envTarget.dispose();
    }
  });
  addEventListener('pageshow', (event) => {
    if (event.persisted) {
      last = performance.now();
      frame = requestAnimationFrame(animate);
    }
  });
}

try {
  start();
} catch (error) {
  console.error('Horizon could not initialize', error);
  fail('The graphics renderer could not initialize. Please reload or try another browser.');
}
