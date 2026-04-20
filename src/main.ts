import computeWGSL from './shaders/compute.wgsl?raw';
import particlesWGSL from './shaders/particles.wgsl?raw';
import shipWGSL from './shaders/ship.wgsl?raw';
import postWGSL from './shaders/post.wgsl?raw';

const PARTICLE_COUNT = 18000;
const WORKGROUP_SIZE = 128;
const WORLD_HALF_X = 1.7;
const WORLD_HALF_Y = 1.0;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const LEVEL_OBJECTIVE_TARGETS = [0, 60, 140, 260, 420, 620];

interface BlackHole {
  x: number;
  y: number;
  mass: number;
}

class InputState {
  up = false;
  down = false;
  left = false;
  right = false;
  boost = false;

  constructor() {
    const set = (e: KeyboardEvent, value: boolean): void => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') this.up = value;
      if (k === 's' || k === 'arrowdown') this.down = value;
      if (k === 'a' || k === 'arrowleft') this.left = value;
      if (k === 'd' || k === 'arrowright') this.right = value;
      if (k === 'shift') this.boost = value;
    };

    window.addEventListener('keydown', (e) => set(e, true));
    window.addEventListener('keyup', (e) => set(e, false));
  }
}

class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly input = new InputState();

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  private particleBuffer!: GPUBuffer;
  private simUniformBuffer!: GPUBuffer;
  private shipUniformBuffer!: GPUBuffer;
  private postUniformBuffer!: GPUBuffer;
  private statsBuffer!: GPUBuffer;
  private statsReadbackBuffer!: GPUBuffer;

  private computePipeline!: GPUComputePipeline;
  private particlePipeline!: GPURenderPipeline;
  private shipPipeline!: GPURenderPipeline;
  private postPipeline!: GPURenderPipeline;

  private computeBindGroup!: GPUBindGroup;
  private particleBindGroup!: GPUBindGroup;
  private shipBindGroup!: GPUBindGroup;
  private postBindGroup!: GPUBindGroup;

  private sceneTexture!: GPUTexture;
  private sceneView!: GPUTextureView;
  private postSampler!: GPUSampler;

  private running = false;
  private gameOver = false;

  private shipPos = { x: 0.72, y: 0.0 };
  private shipVel = { x: 0.0, y: 0.34 };
  private shipHeading = Math.PI;
  private shipRadius = 0.028;
  private fuel = 100;
  private hull = 100;
  private score = 0;
  private elapsed = 0;
  private levelObjective = 0;
  private objectiveRate = 0;

  private level = 1;
  private binaryBlend = 0;
  private radiationIntensity = 0;
  private asteroidChaos = 0;
  private collisionPending = false;
  private awaitingLevelChoice = false;
  private recentHitTimer = 0;

  private bhA: BlackHole = { x: 0, y: 0, mass: 0.052 };
  private bhB: BlackHole = { x: 0.45, y: 0, mass: 0.04 };

  private readonly iscoRadius = 0.3;
  private readonly horizonRadius = 0.11;

  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement, hud: HTMLDivElement, overlay: HTMLDivElement) {
    this.canvas = canvas;
    this.hud = hud;
    this.overlay = overlay;

    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser. Use latest Chrome/Edge with WebGPU enabled.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Could not acquire a GPU adapter.');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });

    this.createResources();
    this.createPipelines();
    this.resize();
    this.reset();

    requestAnimationFrame((t) => this.frame(t));
  }

  private createResources(): void {
    const particleStride = 8;
    const particleData = new Float32Array(PARTICLE_COUNT * particleStride);

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const kind = i % 9 === 0 ? 1 : 0;
      const angle = Math.random() * Math.PI * 2;
      const r = this.iscoRadius + 0.1 + Math.random() * 0.8;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const speed = 0.35 + Math.random() * 0.95;
      const tx = -Math.sin(angle) * speed;
      const ty = Math.cos(angle) * speed;
      const radius = kind ? 0.003 + Math.random() * 0.004 : 0.0038 + Math.random() * 0.0062;

      const o = i * particleStride;
      particleData[o + 0] = x;
      particleData[o + 1] = y;
      particleData[o + 2] = tx;
      particleData[o + 3] = ty;
      particleData[o + 4] = radius;
      particleData[o + 5] = kind;
      particleData[o + 6] = Math.random();
      particleData[o + 7] = 1;
    }

    this.particleBuffer = this.device.createBuffer({
      size: particleData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);

    this.simUniformBuffer = this.device.createBuffer({
      size: 6 * 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.shipUniformBuffer = this.device.createBuffer({
      size: 2 * 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.postUniformBuffer = this.device.createBuffer({
      size: 3 * 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.statsBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    this.statsReadbackBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    this.postSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.createSceneTexture();
  }

  private createSceneTexture(): void {
    this.sceneTexture?.destroy();
    this.sceneTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.sceneView = this.sceneTexture.createView();
  }

  private createPipelines(): void {
    const computeModule = this.device.createShaderModule({ code: computeWGSL });
    const particlesModule = this.device.createShaderModule({ code: particlesWGSL });
    const shipModule = this.device.createShaderModule({ code: shipWGSL });
    const postModule = this.device.createShaderModule({ code: postWGSL });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: computeModule,
        entryPoint: 'main'
      }
    });

    this.particlePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particlesModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: particlesModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.shipPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shipModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shipModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.postPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: postModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: postModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.simUniformBuffer } },
        { binding: 2, resource: { buffer: this.statsBuffer } }
      ]
    });

    this.particleBindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.simUniformBuffer } }
      ]
    });

    this.shipBindGroup = this.device.createBindGroup({
      layout: this.shipPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shipUniformBuffer } }]
    });

    this.postBindGroup = this.device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.postSampler },
        { binding: 1, resource: this.sceneView },
        { binding: 2, resource: { buffer: this.postUniformBuffer } }
      ]
    });
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    if (this.device) {
      this.createSceneTexture();
      this.postBindGroup = this.device.createBindGroup({
        layout: this.postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.postSampler },
          { binding: 1, resource: this.sceneView },
          { binding: 2, resource: { buffer: this.postUniformBuffer } }
        ]
      });
    }
  }

  private reset(): void {
    this.shipPos = { x: 0.72, y: 0.0 };
    this.shipVel = { x: 0, y: 0.34 };
    this.shipHeading = Math.PI;
    this.fuel = 100;
    this.hull = 100;
    this.score = 0;
    this.elapsed = 0;
    this.levelObjective = 0;
    this.objectiveRate = 0;
    this.level = 1;
    this.binaryBlend = 0;
    this.radiationIntensity = 0;
    this.asteroidChaos = 0;
    this.gameOver = false;
    this.awaitingLevelChoice = false;
    this.recentHitTimer = 0;
    this.lastTime = 0;

    this.renderStartOverlay();
  }

  private computeDanger(): number {
    const dA = Math.hypot(this.shipPos.x - this.bhA.x, this.shipPos.y - this.bhA.y);
    const dB = Math.hypot(this.shipPos.x - this.bhB.x, this.shipPos.y - this.bhB.y);
    const d = Math.min(dA, this.binaryBlend > 0.5 ? dB : Number.POSITIVE_INFINITY);
    return clamp((this.iscoRadius - d) / (this.iscoRadius - this.horizonRadius), 0, 1);
  }

  private updateDifficulty(dt: number): boolean {
    const targetForLevel = LEVEL_OBJECTIVE_TARGETS[this.level];
    const targetLevel = this.level < 5 && this.levelObjective >= targetForLevel ? this.level + 1 : this.level;
    if (targetLevel > this.level) {
      const completedLevel = this.level;
      this.level = targetLevel;
      this.showLevelPassOverlay(completedLevel, targetLevel);
      return true;
    }

    this.radiationIntensity = this.level >= 3 ? clamp((this.level - 2) * 0.45, 0, 1.25) : 0;
    this.asteroidChaos = this.level >= 2 ? clamp(0.35 + (this.level - 2) * 0.25, 0, 1.0) : 0;

    if (this.level >= 4) {
      this.bhA.mass = 0.052 + (this.elapsed - 105) * 0.0001;
    } else {
      this.bhA.mass = lerp(this.bhA.mass, 0.052, 0.05);
    }

    if (this.level >= 5) {
      this.binaryBlend = clamp(this.binaryBlend + dt * 0.35, 0, 1);
      const t = this.elapsed * 0.34;
      this.bhB.x = Math.cos(t) * 0.42;
      this.bhB.y = Math.sin(t) * 0.28;
    } else {
      this.binaryBlend = clamp(this.binaryBlend - dt * 0.5, 0, 1);
      this.bhB.x = 0.45;
      this.bhB.y = 0;
    }

    return false;
  }

  private updateShip(dt: number): void {
    this.recentHitTimer = Math.max(0, this.recentHitTimer - dt);

    const ax = Number(this.input.right) - Number(this.input.left);
    const ay = Number(this.input.up) - Number(this.input.down);
    const mag = Math.hypot(ax, ay);
    const boost = this.input.boost && this.fuel > 0;
    const preDanger = this.computeDanger();

    let thrustX = 0;
    let thrustY = 0;

    if (mag > 0.0001 && this.fuel > 0) {
      const thrustPower = (boost ? 1.8 : 1.05) * (1 + preDanger * 0.65);
      thrustX = (ax / mag) * thrustPower;
      thrustY = (ay / mag) * thrustPower;
      this.shipHeading = Math.atan2(thrustY, thrustX) - Math.PI / 2;

      const baseBurn = (boost ? 11.5 : 5.0) * (1 + preDanger * 0.75 + (boost ? 0.25 : 0));
      this.fuel = Math.max(0, this.fuel - baseBurn * dt);
    }

    const gravA = this.gravityAt(this.shipPos.x, this.shipPos.y, this.bhA, this.bhA.mass);
    const gravB = this.gravityAt(this.shipPos.x, this.shipPos.y, this.bhB, this.bhB.mass * this.binaryBlend);

    const radiationPulse = this.level >= 3 ? Math.max(0, Math.sin(this.elapsed * 1.8 + this.level)) * this.radiationIntensity : 0;
    const radiationDrain = radiationPulse * (this.level >= 4 ? 2.2 : 1.1);

    const thrustAuthority = 0.95 + preDanger * 0.9;
    this.shipVel.x += (thrustX * thrustAuthority + gravA.x + gravB.x) * dt;
    this.shipVel.y += (thrustY * thrustAuthority + gravA.y + gravB.y) * dt;
    this.shipVel.x *= 1 - Math.min(0.1 * dt, 0.06);
    this.shipVel.y *= 1 - Math.min(0.1 * dt, 0.06);

    this.shipPos.x += this.shipVel.x * dt;
    this.shipPos.y += this.shipVel.y * dt;

    this.fuel = Math.max(0, this.fuel - radiationDrain * dt);

    const dA = Math.hypot(this.shipPos.x - this.bhA.x, this.shipPos.y - this.bhA.y);
    const dB = Math.hypot(this.shipPos.x - this.bhB.x, this.shipPos.y - this.bhB.y);
    const closest = Math.min(dA, this.binaryBlend > 0.5 ? dB : Number.POSITIVE_INFINITY);
    const danger = this.computeDanger();
    this.score += dt * (1.5 + danger * 30 + this.binaryBlend * 22);

    // Risk/reward progression:
    // far orbit gives almost no objective gain; danger-zone maneuvering pays heavily.
    const maneuvering = mag > 0.0001 ? (boost ? 0.45 : 0.2) : 0;
    const iscoProximity = clamp((0.62 - closest) / 0.34, 0, 1);
    const riskCurve = iscoProximity * iscoProximity;
    const pilotBonus = maneuvering * (0.4 + iscoProximity * 1.4 + danger * 1.8);
    const binaryBonus = this.binaryBlend * (0.25 + danger * 0.6);
    const objectivePerSecond =
      0.03 +
      iscoProximity * 0.5 +
      riskCurve * 2.2 +
      danger * 3.0 +
      pilotBonus +
      binaryBonus;
    this.objectiveRate = objectivePerSecond;
    this.levelObjective += objectivePerSecond * dt;

    if (dA < this.horizonRadius || (this.binaryBlend > 0.45 && dB < this.horizonRadius * 0.95)) {
      this.hull = 0;
    }

    if (this.fuel <= 0) {
      this.hull -= dt * (2 + danger * 14);
    }

    if (Math.abs(this.shipPos.x) > WORLD_HALF_X * 1.1 || Math.abs(this.shipPos.y) > WORLD_HALF_Y * 1.1) {
      this.hull -= dt * 26;
    }

    // Reward cleaner flying: once collisions stop briefly, hull recovers slowly.
    if (this.recentHitTimer <= 0 && this.hull > 0) {
      const regenRate = Math.max(0.08, 0.42 - danger * 0.24);
      this.hull = Math.min(100, this.hull + regenRate * dt);
    }
  }

  private gravityAt(x: number, y: number, bh: BlackHole, mass: number): { x: number; y: number } {
    const dx = bh.x - x;
    const dy = bh.y - y;
    const r2 = Math.max(dx * dx + dy * dy, 0.0008);
    const inv = 1 / Math.sqrt(r2);
    const inv3 = inv * inv * inv;
    return { x: dx * mass * inv3, y: dy * mass * inv3 };
  }

  private uploadUniforms(dt: number): void {
    const sim = new Float32Array(24);
    sim.set([dt, this.elapsed, PARTICLE_COUNT, this.level], 0);
    sim.set([this.iscoRadius, this.horizonRadius, this.bhA.mass * 3.6, this.binaryBlend], 4);
    sim.set([this.shipPos.x, this.shipPos.y, this.shipRadius, 0.18 + this.level * 0.16], 8);
    sim.set([this.bhA.x, this.bhA.y, this.bhA.mass * 4.4, 0], 12);
    sim.set([this.bhB.x, this.bhB.y, this.bhB.mass * 4.4, 0], 16);
    sim.set([WORLD_HALF_X, WORLD_HALF_Y, this.radiationIntensity, this.asteroidChaos], 20);
    this.device.queue.writeBuffer(this.simUniformBuffer, 0, sim);

    const ship = new Float32Array(8);
    ship.set([this.shipPos.x, this.shipPos.y, this.shipHeading, this.shipRadius], 0);
    ship.set([WORLD_HALF_X, WORLD_HALF_Y, this.computeDanger(), this.fuel / 100], 4);
    this.device.queue.writeBuffer(this.shipUniformBuffer, 0, ship);

    const post = new Float32Array(12);
    post.set([this.bhA.x, this.bhA.y, this.bhA.mass * 3.0, 0], 0);
    post.set([this.bhB.x, this.bhB.y, this.bhB.mass * 2.7, 0], 4);
    post.set([WORLD_HALF_X, WORLD_HALF_Y, 0.00019 + this.computeDanger() * 0.00035, this.binaryBlend], 8);
    this.device.queue.writeBuffer(this.postUniformBuffer, 0, post);
  }

  private frame(t: number): void {
    requestAnimationFrame((next) => this.frame(next));

    if (!this.running || this.gameOver) return;

    if (this.lastTime === 0) {
      this.lastTime = t;
      return;
    }

    const dt = Math.min(0.033, (t - this.lastTime) / 1000);
    this.lastTime = t;
    this.elapsed += dt;

    const pausedForLevelPrompt = this.updateDifficulty(dt);
    if (pausedForLevelPrompt) {
      this.drawHud();
      return;
    }
    this.updateShip(dt);
    this.uploadUniforms(dt);

    this.device.queue.writeBuffer(this.statsBuffer, 0, new Uint32Array([0]));

    const encoder = this.device.createCommandEncoder();

    const cpass = encoder.beginComputePass();
    cpass.setPipeline(this.computePipeline);
    cpass.setBindGroup(0, this.computeBindGroup);
    cpass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
    cpass.end();

    const scenePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.sceneView,
        clearValue: { r: 0.01, g: 0.01, b: 0.018, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    scenePass.setPipeline(this.particlePipeline);
    scenePass.setBindGroup(0, this.particleBindGroup);
    scenePass.draw(6, PARTICLE_COUNT);

    scenePass.setPipeline(this.shipPipeline);
    scenePass.setBindGroup(0, this.shipBindGroup);
    scenePass.draw(6, 1);
    scenePass.end();

    const presentPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    presentPass.setPipeline(this.postPipeline);
    presentPass.setBindGroup(0, this.postBindGroup);
    presentPass.draw(3, 1);
    presentPass.end();

    encoder.copyBufferToBuffer(this.statsBuffer, 0, this.statsReadbackBuffer, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    if (!this.collisionPending) {
      this.collisionPending = true;
      void this.statsReadbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const arr = new Uint32Array(this.statsReadbackBuffer.getMappedRange());
        const hits = arr[0];
        this.statsReadbackBuffer.unmap();
        this.collisionPending = false;

        if (hits > 0) {
          const danger = this.computeDanger();
          this.recentHitTimer = 0.8;
          const pressure = Math.sqrt(Math.min(hits, 36));
          const chipDamage = pressure * (0.002 + danger * 0.006);
          const frameCap = 0.09 + danger * 0.14;
          this.hull = Math.max(0, this.hull - Math.min(frameCap, chipDamage));
        }
      }).catch(() => {
        this.collisionPending = false;
      });
    }

    this.drawHud();

    if (this.hull <= 0) {
      this.endRun();
    }
  }

  private drawHud(): void {
    const dA = Math.hypot(this.shipPos.x - this.bhA.x, this.shipPos.y - this.bhA.y);
    const dB = Math.hypot(this.shipPos.x - this.bhB.x, this.shipPos.y - this.bhB.y);
    const closest = Math.min(dA, this.binaryBlend > 0.5 ? dB : Number.POSITIVE_INFINITY);
    const zone = closest > this.iscoRadius ? 'Stable Orbit' : closest > this.horizonRadius ? 'ISCO Danger Zone' : 'EVENT HORIZON';

    const objectiveTarget = LEVEL_OBJECTIVE_TARGETS[this.level];
    const objectivePct = clamp((this.levelObjective / objectiveTarget) * 100, 0, 100);
    this.hud.textContent = [
      `Level: ${this.level} / 5`,
      `Objective: ${this.levelObjective.toFixed(0)} / ${objectiveTarget} (${objectivePct.toFixed(0)}%)`,
      `Objective Rate: ${this.objectiveRate.toFixed(2)} /s`,
      `Fuel: ${this.fuel.toFixed(1)}%`,
      `Hull: ${Math.max(this.hull, 0).toFixed(1)}%`,
      `Score: ${Math.floor(this.score)}`,
      `Closest Radius: ${closest.toFixed(3)} (${zone})`,
      `Binary Influence: ${(this.binaryBlend * 100).toFixed(0)}%`,
      `Time Survived: ${this.elapsed.toFixed(1)}s`
    ].join('\n');

    this.hud.style.borderColor = this.computeDanger() > 0.5 ? 'var(--danger)' : '#2e3b5a';
  }

  private endRun(): void {
    this.gameOver = true;
    this.running = false;
    this.overlay.classList.remove('hidden');

    const rating = this.score > 3000 ? 'Legendary pilot' : this.score > 1500 ? 'Strong run' : 'Training run';
    this.overlay.innerHTML = `
      <h1>Mission Lost</h1>
      <p>Final score: <strong>${Math.floor(this.score)}</strong></p>
      <p>${rating}. You survived ${this.elapsed.toFixed(1)} seconds.</p>
      <button id="start-btn">Retry</button>
    `;

    const b = this.overlay.querySelector<HTMLButtonElement>('#start-btn');
    if (b) {
      b.addEventListener('click', () => {
        this.reset();
        this.running = true;
        this.overlay.classList.add('hidden');
      });
    }
  }

  private renderStartOverlay(): void {
    this.overlay.innerHTML = `
      <h1>Survive Event Horizon</h1>
      <p>WASD / Arrow keys to thrust. Shift for boost.</p>
      <p>Survive near the ISCO to multiply score, but watch your fuel.</p>
      <button id="start-btn">Start Mission</button>
    `;

    const b = this.overlay.querySelector<HTMLButtonElement>('#start-btn');
    if (!b) return;
    b.addEventListener('click', () => {
      this.running = true;
      this.overlay.classList.add('hidden');
    });
  }

  private showLevelPassOverlay(completedLevel: number, enteredLevel: number): void {
    if (this.awaitingLevelChoice || completedLevel >= 5) {
      return;
    }

    this.awaitingLevelChoice = true;
    this.running = false;
    this.levelObjective = 0;
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <h1>Level ${completedLevel} Cleared</h1>
      <p>You passed Level ${completedLevel}. Enter Level ${enteredLevel}?</p>
      <p>Score: <strong>${Math.floor(this.score)}</strong> | Hull: <strong>${Math.max(this.hull, 0).toFixed(1)}%</strong></p>
      <div style="display:flex; gap:10px; margin-top: 10px;">
        <button id="continue-btn">Continue</button>
        <button id="exit-btn" style="background: linear-gradient(135deg, #ffd7a1, #ff8b8b);">Exit</button>
      </div>
    `;

    const continueBtn = this.overlay.querySelector<HTMLButtonElement>('#continue-btn');
    const exitBtn = this.overlay.querySelector<HTMLButtonElement>('#exit-btn');

    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        this.awaitingLevelChoice = false;
        this.running = true;
        this.overlay.classList.add('hidden');
      });
    }

    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        this.awaitingLevelChoice = false;
        this.running = false;
        this.reset();
      });
    }
  }
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  const hud = document.querySelector<HTMLDivElement>('#hud');
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (!canvas || !hud || !overlay) {
    throw new Error('Required DOM nodes were not found.');
  }

  const game = new Game(canvas, hud, overlay);

  try {
    await game.init();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown initialization error';
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <h1>WebGPU Init Failed</h1>
      <p>${message}</p>
      <p>Use latest Chrome/Edge and enable hardware acceleration.</p>
    `;
  }
}

void main();
