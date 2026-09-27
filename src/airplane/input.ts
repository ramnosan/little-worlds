import { AirplaneWorld } from './physics';

export class FlightControls {
  private abort = new AbortController();
  private keys = new Set<string>();
  private keyboard = { pitch: 0, roll: 0, yaw: 0 };
  private sticks = new Map<string, { id: number; x: number; y: number }>();
  constructor(
    private world: AirplaneWorld,
    private root: HTMLElement,
    actions: { pause(): void; reset(): void; suspend(): void; camera(): void },
  ) {
    const signal = this.abort.signal;
    document.addEventListener(
      'keydown',
      (e) => {
        if (
          e.metaKey ||
          e.altKey ||
          (e.target instanceof HTMLElement &&
            e.target.closest('input,button,a,select,textarea,[contenteditable]'))
        )
          return;
        if (
          [
            'ShiftLeft',
            'ShiftRight',
            'ControlLeft',
            'ControlRight',
            'KeyW',
            'KeyS',
            'KeyA',
            'KeyD',
            'KeyQ',
            'KeyE',
            'Space',
            'KeyR',
            'KeyC',
          ].includes(e.code)
        ) {
          e.preventDefault();
          if (e.code === 'Space') {
            if (!e.repeat) actions.pause();
          } else if (e.code === 'KeyC') {
            if (!e.repeat) actions.camera();
          } else if (e.code === 'KeyR') {
            if (!e.repeat) actions.reset();
          } else if (!this.world.paused && this.world.state !== 'crashed') this.keys.add(e.code);
        }
      },
      { signal },
    );
    document.addEventListener('keyup', (e) => this.keys.delete(e.code), { signal });
    document.addEventListener(
      'focusin',
      (e) => {
        if (e.target instanceof HTMLElement && e.target.closest('input,button,a,select,textarea'))
          this.clear();
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.clear();
        actions.suspend();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.clear();
          actions.suspend();
        }
      },
      { signal },
    );
    root.querySelectorAll<HTMLElement>('[data-stick]').forEach((pad) => {
      const name = pad.dataset.stick!;
      const move = (e: PointerEvent) => {
        if (this.world.paused || this.world.state === 'crashed') return;
        const stick = this.sticks.get(name);
        if (!stick || stick.id !== e.pointerId) return;
        const rect = pad.getBoundingClientRect();
        stick.x = Math.max(
          -1,
          Math.min(1, (e.clientX - rect.left - rect.width / 2) / (rect.width * 0.36)),
        );
        stick.y = Math.max(
          -1,
          Math.min(1, (e.clientY - rect.top - rect.height / 2) / (rect.height * 0.36)),
        );
        if (name === 'left') this.world.setInput({ throttle: (1 - stick.y) / 2 });
        this.draw();
      };
      pad.addEventListener(
        'pointerdown',
        (e) => {
          if (this.world.paused || this.world.state === 'crashed' || this.sticks.has(name)) return;
          e.preventDefault();
          pad.setPointerCapture(e.pointerId);
          this.sticks.set(name, { id: e.pointerId, x: 0, y: 0 });
          move(e);
        },
        { signal },
      );
      pad.addEventListener('pointermove', move, { signal });
      const release = (e: PointerEvent) => {
        if (this.sticks.get(name)?.id === e.pointerId) {
          this.sticks.delete(name);
          this.update(0);
        }
      };
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
        pad.addEventListener(event, release as EventListener, { signal });
    });
  }
  update(dt: number) {
    if (this.world.paused || this.world.state === 'crashed') return;
    const axis = (positive: string, negative: string) =>
      Number(this.keys.has(positive)) - Number(this.keys.has(negative));
    const targets = {
      pitch: axis('KeyS', 'KeyW'),
      roll: axis('KeyD', 'KeyA'),
      yaw: axis('KeyE', 'KeyQ'),
    };
    for (const name of ['pitch', 'roll', 'yaw'] as const) {
      const change = targets[name] - this.keyboard[name];
      const travel = dt * (targets[name] === 0 ? 4 : 2.5);
      this.keyboard[name] += Math.max(-travel, Math.min(travel, change));
    }
    this.world.setInput({
      throttle:
        this.world.input.throttle +
        (Number(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) -
          Number(this.keys.has('ControlLeft') || this.keys.has('ControlRight'))) *
          dt *
          0.4,
      pitch: this.sticks.get('right')?.y ?? this.keyboard.pitch,
      roll: this.sticks.get('right')?.x ?? this.keyboard.roll,
      yaw: this.sticks.get('left')?.x ?? this.keyboard.yaw,
    });
    this.draw();
  }
  private draw() {
    this.root.querySelectorAll<HTMLElement>('[data-stick]').forEach((pad) => {
      const name = pad.dataset.stick!,
        stick = this.sticks.get(name);
      pad.style.setProperty('--stick-x', String((stick?.x ?? 0) * 36) + '%');
      pad.style.setProperty(
        '--stick-y',
        String((name === 'left' ? 1 - 2 * this.world.input.throttle : (stick?.y ?? 0)) * 36) + '%',
      );
    });
  }
  clear() {
    this.keys.clear();
    this.keyboard.pitch = 0;
    this.keyboard.roll = 0;
    this.keyboard.yaw = 0;
    this.sticks.clear();
    this.world.setInput({ pitch: 0, roll: 0, yaw: 0 });
    this.draw();
  }
  dispose() {
    this.clear();
    this.abort.abort();
  }
}
