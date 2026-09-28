import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRaptor } from './aircraft.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = THREE.MathUtils.smoothstep;
$('retry').onclick = () => location.reload();
function fail(message) {
  $('fallback').hidden = false;
  $('fallback').querySelector('.error-detail').textContent = message;
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const viewport = $('viewport');
  viewport.appendChild(canvas);
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '3D F-22 Raptor. Drag or use arrow keys to orbit; scroll or pinch to zoom.',
  );
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8eae9');
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 180);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minDistance = 9;
  controls.maxDistance = 90;
  controls.minPolarAngle = 0.015;
  controls.maxPolarAngle = Math.PI * 0.94;
  controls.zoomSpeed = 0.65;
  controls.rotateSpeed = 0.65;
  controls.target.set(0, 1.5, 0);

  const room = new RoomEnvironment(),
    pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#f4f7ff', '#87918d', 1.0));
  const key = new THREE.DirectionalLight('#fff9ef', 1.9);
  key.position.set(-8, 17, -10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -14,
    right: 14,
    top: 14,
    bottom: -14,
    near: 0.1,
    far: 55,
  });
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.00012;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d7e7ff', 1.15);
  fill.position.set(8, 7, 5);
  scene.add(fill);
  const model = createRaptor(),
    jet = model.jet;
  scene.add(jet);
  const groundOffset = 1.69;
  jet.position.y = groundOffset;

  const platformMaterial = new THREE.MeshStandardMaterial({
    color: '#d4dad8',
    metalness: 0.28,
    roughness: 0.47,
  });
  const display = new THREE.Group();
  scene.add(display);
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(10.4, 10.48, 0.24, 128),
    platformMaterial,
  );
  platform.position.y = 0.12;
  platform.receiveShadow = true;
  display.add(platform);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: '#aab5b5',
    metalness: 0.5,
    roughness: 0.4,
  });
  for (const [r, thickness] of [
    [10.38, 0.015],
    [9.97, 0.008],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, thickness, 6, 160), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.245;
    display.add(ring);
  }
  const tickGeo = new THREE.BoxGeometry(1, 1, 1),
    ticks = new THREE.InstancedMesh(tickGeo, ringMaterial, 80),
    dummy = new THREE.Object3D();
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * 10.16, 0.247, Math.cos(a) * 10.16);
    dummy.rotation.y = a;
    dummy.scale.set(0.012, 0.003, i % 5 ? 0.06 : 0.16);
    dummy.updateMatrix();
    ticks.setMatrixAt(i, dummy.matrix);
  }
  display.add(ticks);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(250, 250),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.008;
  floor.receiveShadow = true;
  scene.add(floor);

  // Sample the rendered studio through two transparent exhaust volumes. This
  // distorts the actual scene behind the exhaust, rather than drawing smoke.
  const background = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const heatMaterial = new THREE.ShaderMaterial({
    uniforms: {
      studio: { value: background.texture },
      resolution: { value: new THREE.Vector2() },
      time: { value: 0 },
      power: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D studio; uniform vec2 resolution; uniform float time; uniform float power; varying vec2 vUv;
      void main(){float envelope=sin(vUv.y*3.14159)*pow(sin(vUv.x*3.14159),2.);
      vec2 screen=gl_FragCoord.xy/resolution;
      vec2 wave=vec2(sin(vUv.y*48.-time*12.+vUv.x*17.),cos(vUv.y*32.-time*9.));
      vec2 displaced=screen+wave*envelope*power*0.0018;
      gl_FragColor=vec4(texture2D(studio,displaced).rgb,envelope*power*.3);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const heat = new THREE.Group();
  jet.add(heat);
  const heatGeometry = new THREE.CylinderGeometry(0.59, 0.38, 3.3, 16, 14, true);
  for (const side of [-1, 1]) {
    const plume = new THREE.Mesh(heatGeometry, heatMaterial);
    plume.rotation.x = Math.PI / 2;
    plume.position.set(side * 1.04, -0.02, 11.02);
    heat.add(plume);
  }
  heat.visible = false;

  let running = false,
    flight = false,
    auto = false,
    throttle = 0.65,
    rpm = 0;
  let progress = 0,
    altitude = 0,
    gear = 0,
    door = 1,
    bank = 0,
    pitch = 0;
  let time = 0,
    last = performance.now(),
    frame = 0,
    lost = false,
    finish = 'gray';
  let cameraGoal = null,
    homeDistance = 40,
    noticeUntil = 0;
  const homeDirection = new THREE.Vector3(-1.12, 0.79, -1.38).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  function fittedDistance() {
    const vfov = THREE.MathUtils.degToRad(camera.fov),
      hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    return 10.8 / Math.sin(Math.min(vfov, hfov) / 2);
  }
  function view(direction, immediate = false) {
    auto = false;
    $('auto').setAttribute('aria-pressed', 'false');
    const target = new THREE.Vector3(0, 1.5, 0),
      factor = Math.abs(direction.y / direction.length()) > 0.9 || camera.aspect < 1.3 ? 1 : 0.84;
    const position = direction
      .clone()
      .normalize()
      .multiplyScalar(homeDistance * factor)
      .add(target);
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
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    background.setSize(size.x, size.y);
    heatMaterial.uniforms.resolution.value.copy(size);
    const previous = homeDistance;
    homeDistance = fittedDistance();
    controls.maxDistance = homeDistance * 1.9;
    camera.position
      .sub(controls.target)
      .multiplyScalar(homeDistance / previous)
      .add(controls.target);
    // Also refit an in-progress preset after orientation/fullscreen changes.
    if (cameraGoal)
      cameraGoal.position
        .sub(cameraGoal.target)
        .multiplyScalar(homeDistance / previous)
        .add(cameraGoal.target);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  view(homeDirection, true);
  function cancelOrbit() {
    cameraGoal = null;
    auto = false;
    $('auto').setAttribute('aria-pressed', 'false');
  }
  controls.addEventListener('start', cancelOrbit);
  function notice(text) {
    $('notice').textContent = text;
    noticeUntil = time + 6;
  }
  function sync() {
    $('engines').textContent = running ? 'Ⅱ  Stop engines' : '▷  Start engines';
    $('engines').setAttribute('aria-pressed', String(running));
    $('flight').textContent = flight ? '↓  Return to platform' : '↑  Flight display';
    $('flight').setAttribute('aria-pressed', String(flight));
  }
  function toggleEngines() {
    running = !running;
    if (!running) {
      flight = false;
      notice(
        progress > 0
          ? 'Returning to the platform before engine shutdown.'
          : 'Engines spooling down.',
      );
    } else notice('Twin engines starting. Adjust the throttle to explore.');
    sync();
  }
  function toggleFlight() {
    flight = !flight;
    if (flight) {
      running = true;
      notice('Display sequence: lift, retract gear, then bank gently.');
    } else notice('Gear extending. Returning softly to the platform.');
    sync();
  }
  $('engines').onclick = toggleEngines;
  $('flight').onclick = toggleFlight;
  $('auto').onclick = () => {
    auto = !auto;
    cameraGoal = null;
    $('auto').setAttribute('aria-pressed', String(auto));
  };
  $('reset').onclick = () => view(homeDirection);
  const directions = {
    front: new THREE.Vector3(0, 0.09, -1),
    side: new THREE.Vector3(-1, 0.08, 0),
    rear: new THREE.Vector3(0, 0.1, 1),
    top: new THREE.Vector3(0, 1, -0.016),
  };
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => view(directions[button.dataset.view]);
  });
  $('throttle').oninput = () => {
    throttle = Number($('throttle').value) / 100;
    $('throttle-value').textContent = Math.round(throttle * 100) + '%';
  };
  const names = {
    gray: 'Air-superiority gray',
    arctic: 'Arctic demonstrator',
    graphite: 'Dark graphite concept',
  };
  document.querySelectorAll('[data-finish]').forEach((button) => {
    button.onclick = () => {
      finish = button.dataset.finish;
      model.setFinish(finish);
      $('finish-name').textContent = names[finish];
      document
        .querySelectorAll('[data-finish]')
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
      notice('Fullscreen was blocked. Open this page in its own tab and try again.');
    }
  };
  document.addEventListener('fullscreenchange', () =>
    $('fullscreen').setAttribute(
      'aria-label',
      document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen',
    ),
  );
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,button,a') || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggleEngines();
    }
    if (e.code === 'KeyF') toggleFlight();
    if (e.code === 'KeyR') view(homeDirection);
    if (e.target === canvas && e.code.startsWith('Arrow')) {
      e.preventDefault();
      cancelOrbit();
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (e.code === 'ArrowLeft') s.theta -= 0.12;
      if (e.code === 'ArrowRight') s.theta += 0.12;
      if (e.code === 'ArrowUp') s.phi -= 0.1;
      if (e.code === 'ArrowDown') s.phi += 0.1;
      s.phi = THREE.MathUtils.clamp(s.phi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      controls.update();
    }
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    $('status').textContent = 'Graphics paused';
    notice('Graphics paused. Waiting for the renderer to recover.');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    last = performance.now();
    notice('Graphics restored.');
  });
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  function update(dt) {
    time += dt;
    const targetRPM = running ? 0.22 + 0.78 * throttle : progress > 0 ? 0.45 : 0;
    rpm += (targetRPM - rpm) * (1 - Math.exp(-dt / (targetRPM > rpm ? 1.7 : 2.1)));
    if (targetRPM === 0 && rpm < 0.001) rpm = 0;
    // Reversible timeline: landing opens doors first, extends gear at altitude,
    // levels the aircraft, then lowers all three wheels onto the platform.
    if (flight && rpm > 0.16) progress = Math.min(1, progress + dt / 6);
    if (!flight) progress = Math.max(0, progress - dt / 6);
    altitude = smooth(progress, 0, 0.88) * 2.65;
    gear = smooth(progress, 0.28, 0.63);
    door = 1 - smooth(progress, 0.67, 0.84);
    const motion = reducedMotion ? 0 : smooth(progress, 0.72, 1);
    bank = motion ? Math.sin(time * 0.58) * 0.075 * motion : 0;
    pitch = motion ? Math.sin(time * 0.43) * 0.03 * motion : 0;
    jet.position.y = groundOffset + altitude + Math.sin(time * 0.8) * 0.06 * motion;
    jet.rotation.set(pitch, Math.sin(time * 0.31) * 0.018 * motion, bank);
    model.update({ dt, time, rpm, gear, door, motion, bank, pitch });
    heatMaterial.uniforms.time.value = time;
    heatMaterial.uniforms.power.value = rpm * (reducedMotion ? 0 : 1);
    if (cameraGoal) {
      const a = 1 - Math.exp(-dt * 5);
      camera.position.lerp(cameraGoal.position, a);
      controls.target.lerp(cameraGoal.target, a);
      if (camera.position.distanceTo(cameraGoal.position) < 0.005) {
        camera.position.copy(cameraGoal.position);
        controls.target.copy(cameraGoal.target);
        cameraGoal = null;
      }
    }
    if (auto)
      camera.position
        .sub(controls.target)
        .applyAxisAngle(up, dt * 0.14)
        .add(controls.target);
    controls.update();
    if (noticeUntil && time > noticeUntil) {
      $('notice').textContent = '';
      noticeUntil = 0;
    }
    const state =
      progress > 0
        ? flight
          ? progress < 1
            ? 'Taking position'
            : 'Flight display'
          : 'Landing'
        : flight
          ? 'Spooling up'
          : rpm > 0.005
            ? running
              ? Math.abs(rpm - targetRPM) > 0.025
                ? rpm < targetRPM
                  ? 'Spooling up'
                  : 'Spooling down'
                : 'Engines active'
              : 'Spooling down'
            : 'On platform';
    if ($('status').textContent !== state) $('status').textContent = state;
    const telemetry = `N1 ${String(Math.round(rpm * 100)).padStart(3, '0')}% / GEAR ${gear < 0.001 ? 'DOWN' : gear > 0.999 ? 'UP' : 'IN TRANSIT'}`;
    if ($('telemetry').textContent !== telemetry) $('telemetry').textContent = telemetry;
  }
  function render() {
    // Reveal the belly when the visitor orbits below the platform; the studio
    // base would otherwise occlude the aircraft from every lower viewpoint.
    display.visible = camera.position.y > 0.4;
    floor.visible = display.visible;
    heat.visible = false;
    if (rpm > 0.05 && !reducedMotion) {
      // Keep the intermediate target in linear space; apply output conversion
      // once when its distorted pixels are composited into the final scene.
      const tone = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(background);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.toneMapping = tone;
      heat.visible = true;
    }
    renderer.render(scene, camera);
  }
  function animate(now) {
    frame = requestAnimationFrame(animate);
    const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
    last = now;
    if (document.hidden || lost) return;
    update(dt);
    render();
  }
  sync();
  update(0);
  render();
  frame = requestAnimationFrame(animate);
  if (new URLSearchParams(location.search).has('inspect')) {
    jet.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const intakeClearances = model.intakeMouths.map((ring) => {
      const center = ring
        .reduce((sum, p) => sum.add(new THREE.Vector3(...p)), new THREE.Vector3())
        .multiplyScalar(0.25);
      center.z += 0.04;
      ray.set(jet.localToWorld(center), new THREE.Vector3(0, 0, 1));
      return ray.intersectObject(jet, true)[0]?.distance ?? 0;
    });
    const exhaustCores = [-1, 1].map((side) => {
      ray.set(
        jet.localToWorld(new THREE.Vector3(side * 1.04, -0.02, 9.8)),
        new THREE.Vector3(0, 0, -1),
      );
      const hit = ray.intersectObject(jet, true).find((h) => h.object.material !== heatMaterial);
      return { name: hit?.object.name, depth: hit?.distance ?? 0 };
    });
    window.raptorDiagnostics = () => {
      jet.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(jet);
      // Heat volumes are excluded from initial airframe framing samples.
      const points = [
        [0, 0, -9.45],
        [0, 0, 9.45],
        [-6.8, 0.08, 1.88],
        [6.8, 0.08, 1.88],
        [-6.8, 0.08, 3.63],
        [6.8, 0.08, 3.63],
        [-2.6, 2.83, 7.2],
        [2.6, 2.83, 7.2],
      ];
      return {
        running,
        flight,
        auto,
        throttle,
        rpm,
        progress,
        altitude,
        gear,
        door,
        bank,
        pitch,
        finish,
        camera: camera.position.toArray(),
        target: controls.target.toArray(),
        pixelRatio: renderer.getPixelRatio(),
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        airframeBounds: points.map((p) =>
          jet
            .localToWorld(new THREE.Vector3(...p))
            .project(camera)
            .toArray(),
        ),
        gearVisible: model.landingGear.map((g) => g.group.visible),
        wheelBottoms: model.landingGear.map(
          (g) => g.group.localToWorld(new THREE.Vector3(0, g.wheelY, g.wheelZ)).y - g.radius,
        ),
        nozzleAngles: model.nozzles.map((n) => n.rotation.x),
        controlAngles: model.moving.map((m) => m.group.quaternion.toArray()),
        bounds: [bounds.min.toArray(), bounds.max.toArray()],
        reducedMotion,
        intakeClearances,
        exhaustCores,
      };
    };
  }
  addEventListener('pagehide', (event) => {
    cancelAnimationFrame(frame);
    if (!event.persisted) {
      observer.disconnect();
      controls.dispose();
      background.dispose();
      environment.dispose();
      const geometries = new Set(),
        materials = new Set(),
        textures = new Set();
      scene.traverse((obj) => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (obj.material)
          for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material])
            materials.add(mat);
      });
      materials.forEach((mat) => {
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
        mat.dispose();
      });
      textures.forEach((tex) => tex.dispose());
      geometries.forEach((geo) => geo.dispose());
      renderer.dispose();
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
  console.error('Raptor could not initialize', error);
  fail('The graphics renderer could not initialize. Please reload or try another browser.');
}
