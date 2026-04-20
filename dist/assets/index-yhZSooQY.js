var T=Object.defineProperty;var G=(o,e,t)=>e in o?T(o,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):o[e]=t;var s=(o,e,t)=>G(o,typeof e!="symbol"?e+"":e,t);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function t(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(i){if(i.ep)return;i.ep=!0;const r=t(i);fetch(i.href,r)}})();const I=`struct SimParams {
  v0: vec4<f32>,
  v1: vec4<f32>,
  v2: vec4<f32>,
  v3: vec4<f32>,
  v4: vec4<f32>,
  v5: vec4<f32>,
};

struct Particle {
  posVel: vec4<f32>,
  data: vec4<f32>,
};

struct Stats {
  collisionCount: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: SimParams;
@group(0) @binding(2) var<storage, read_write> stats: Stats;

fn hash(x: f32) -> f32 {
  let h = sin(x * 91.3458 + 12.345) * 43758.5453;
  return fract(h);
}

fn gravityAccel(p: vec2<f32>, center: vec2<f32>, mass: f32) -> vec2<f32> {
  let d = center - p;
  let r2 = max(dot(d, d), 0.0008);
  let inv = inverseSqrt(r2);
  let inv3 = inv * inv * inv;
  return d * mass * inv3;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let count = u32(sim.v0.z);
  if (index >= count) {
    return;
  }

  var p = particles[index];
  var pos = p.posVel.xy;
  var vel = p.posVel.zw;
  var radius = p.data.x;
  let kind = p.data.y;

  let dt = sim.v0.x;
  let time = sim.v0.y;
  let horizon = sim.v1.y;
  let binaryBlend = sim.v1.w;
  let asteroidChaos = sim.v5.w;

  let bhA = sim.v3.xy;
  let massA = sim.v3.z;
  let bhB = sim.v4.xy;
  let massB = sim.v4.z;

  var a = gravityAccel(pos, bhA, massA);
  a += gravityAccel(pos, bhB, massB) * binaryBlend;

  // Level 2+ asteroid lane pressure: asteroids pick up mild orbital shear/jitter.
  if (kind < 0.5 && asteroidChaos > 0.001) {
    let shear = normalize(vec2<f32>(-(pos.y - bhA.y), pos.x - bhA.x));
    let jitter = hash(f32(index) * 0.173 + time * 0.71) * 2.0 - 1.0;
    vel += shear * asteroidChaos * 0.24 * dt;
    vel += normalize(pos - bhA) * jitter * asteroidChaos * 0.1 * dt;
  }

  // Mild drag keeps trajectories from exploding numerically over long sessions.
  vel = (vel + a * dt) * (1.0 - min(0.12 * dt, 0.08));
  pos = pos + vel * dt;

  let shipPos = sim.v2.xy;
  let shipRadius = sim.v2.z;
  let deltaShip = pos - shipPos;
  let shipDist = length(deltaShip);
  let collisionRadius = radius * select(0.26, 0.18, kind > 0.5);
  if (shipDist < shipRadius + collisionRadius) {
    atomicAdd(&stats.collisionCount, 1u);
    // Bounce and damp when hitting the ship to make impact visible.
    let n = normalize(select(vec2<f32>(0.0, 1.0), deltaShip, shipDist > 0.0001));
    vel = reflect(vel, n) * 0.5;
    pos = shipPos + n * (shipRadius + collisionRadius + 0.0012);
  }

  let toA = pos - bhA;
  let toB = pos - bhB;
  let distA = length(toA);
  let distB = length(toB);
  let minDist = min(distA, mix(1000.0, distB, binaryBlend));

  let worldHalf = sim.v5.xy;
  let outOfBounds = abs(pos.x) > worldHalf.x * 1.2 || abs(pos.y) > worldHalf.y * 1.2;
  if (minDist < horizon || outOfBounds) {
    let seed = f32(index) + time * (13.0 + kind * 3.17);
    let angle = hash(seed) * 6.283185307;
    let spawnBase = mix(0.12, 0.05, asteroidChaos);
    let spawnRange = mix(0.85, 0.55, asteroidChaos);
    let spawnR = sim.v1.x + spawnBase + hash(seed + 3.1) * spawnRange;
    let side = select(-1.0, 1.0, hash(seed + 9.2) > 0.5);
    let anchor = mix(bhA, bhB, binaryBlend * step(0.5, hash(seed + 7.3)));

    pos = anchor + vec2<f32>(cos(angle), sin(angle)) * spawnR * vec2<f32>(1.0, side);
    let tangent = normalize(vec2<f32>(-(pos.y - anchor.y), pos.x - anchor.x));
    vel = tangent * (0.35 + hash(seed + 4.7) * (0.9 + asteroidChaos * 0.5));

    if (kind > 0.5) {
      // Radiation particles jitter faster and are smaller.
      radius = 0.002 + hash(seed + 11.0) * 0.005;
      vel += normalize(pos - anchor) * (hash(seed + 14.0) - 0.5) * 0.4;
    }
  }

  p.posVel = vec4<f32>(pos, vel);
  p.data.x = radius;
  particles[index] = p;
}
`,E=`struct SimParams {
  v0: vec4<f32>,
  v1: vec4<f32>,
  v2: vec4<f32>,
  v3: vec4<f32>,
  v4: vec4<f32>,
  v5: vec4<f32>,
};

struct Particle {
  posVel: vec4<f32>,
  data: vec4<f32>,
};

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) kind: f32,
  @location(2) seed: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: SimParams;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VSOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );

  let p = particles[instanceIndex];
  let worldHalf = sim.v5.xy;
  let radius = p.data.x;
  let corner = corners[vertexIndex] * radius;
  let worldPos = p.posVel.xy + corner;

  var out: VSOut;
  out.position = vec4<f32>(worldPos / worldHalf, 0.0, 1.0);
  out.local = corners[vertexIndex];
  out.kind = p.data.y;
  out.seed = p.data.z;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let r = length(in.local);
  if (r > 1.0) {
    discard;
  }

  let glow = pow(1.0 - r, 1.75);
  let swirl = 0.5 + 0.5 * sin(atan2(in.local.y, in.local.x) * 3.0 + in.seed * 6.2831);
  let dustNoise = fract(sin(dot(in.local + vec2<f32>(in.seed), vec2<f32>(12.3, 77.7))) * 43758.5453);

  let starBlue = vec3<f32>(0.56, 0.72, 1.0);
  let starCyan = vec3<f32>(0.62, 0.95, 1.0);
  let nebulaMagenta = vec3<f32>(0.85, 0.42, 1.0);
  let nebulaAmber = vec3<f32>(1.0, 0.62, 0.28);
  let asteroidColor = mix(starBlue, starCyan, in.seed);
  let radiationColor = mix(nebulaMagenta, nebulaAmber, swirl);
  let baseColor = mix(asteroidColor, radiationColor, step(0.5, in.kind));

  let sparkle = step(0.92, dustNoise) * (0.6 + 0.8 * swirl);
  let rim = pow(1.0 - r, 2.5);
  let alpha = clamp(glow * (0.55 + 0.45 * swirl), 0.0, 1.0);

  var color = baseColor * (0.2 + glow * 1.15 + rim * 0.65);
  color += vec3<f32>(0.9, 0.95, 1.0) * sparkle * rim * 0.7;
  return vec4<f32>(color, alpha);
}
`,_=`struct ShipParams {
  data0: vec4<f32>, // x, y, heading, radius
  data1: vec4<f32>, // worldHalfX, worldHalfY, danger, fuel01
};

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) danger: f32,
  @location(2) fuel: f32,
};

@group(0) @binding(0) var<uniform> ship: ShipParams;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );

  let angle = ship.data0.z;
  let c = cos(angle);
  let s = sin(angle);
  let rot = mat2x2<f32>(vec2<f32>(c, s), vec2<f32>(-s, c));

  let local = corners[vertexIndex];
  let scale = vec2<f32>(ship.data0.w * 1.25, ship.data0.w * 1.95);
  let p = rot * (local * scale) + ship.data0.xy;

  var out: VSOut;
  out.position = vec4<f32>(p / ship.data1.xy, 0.0, 1.0);
  out.local = local;
  out.danger = ship.data1.z;
  out.fuel = ship.data1.w;
  return out;
}

fn sdfEllipse(p: vec2<f32>, r: vec2<f32>) -> f32 {
  return length(p / r) - 1.0;
}

fn sdfBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let p = in.local;

  let hull = sdfEllipse(vec2<f32>(p.x, p.y - 0.05), vec2<f32>(0.42, 0.78));
  let nose = sdfEllipse(vec2<f32>(p.x, p.y - 0.55), vec2<f32>(0.24, 0.33));
  let wingL = sdfBox(vec2<f32>(p.x + 0.55, p.y + 0.1), vec2<f32>(0.23, 0.07));
  let wingR = sdfBox(vec2<f32>(p.x - 0.55, p.y + 0.1), vec2<f32>(0.23, 0.07));
  let engine = sdfEllipse(vec2<f32>(p.x, p.y + 0.72), vec2<f32>(0.18, 0.12));
  let cockpit = sdfEllipse(vec2<f32>(p.x, p.y - 0.2), vec2<f32>(0.12, 0.2));

  var d = min(hull, nose);
  d = min(d, wingL);
  d = min(d, wingR);
  let inside = 1.0 - smoothstep(0.0, 0.03, d);
  if (inside < 0.01) {
    discard;
  }

  let panelLines = smoothstep(0.015, 0.0, abs(p.x) - 0.22) * smoothstep(0.65, -0.1, p.y);
  let safeColor = vec3<f32>(0.45, 0.95, 0.8);
  let dangerColor = vec3<f32>(1.0, 0.25, 0.25);
  let hullColor = mix(safeColor, dangerColor, in.danger);

  let cockpitMask = 1.0 - smoothstep(0.0, 0.05, cockpit);
  let cockpitColor = vec3<f32>(0.65, 0.88, 1.0) * (0.8 + 0.4 * in.fuel);

  let engineMask = 1.0 - smoothstep(0.0, 0.08, engine);
  let engineColor = mix(vec3<f32>(0.2, 0.5, 1.0), vec3<f32>(0.8, 0.95, 1.0), in.fuel) * (1.0 + 0.6 * in.fuel);

  var color = hullColor * (0.35 + 0.65 * inside);
  color += vec3<f32>(0.08, 0.1, 0.14) * panelLines;
  color = mix(color, cockpitColor, cockpitMask * 0.9);
  color += engineColor * engineMask * 0.9;

  let rim = 1.0 - smoothstep(0.0, 0.08, abs(d));
  color += mix(vec3<f32>(0.1, 0.25, 0.35), dangerColor, in.danger) * rim * 0.25;

  return vec4<f32>(color, inside);
}
`,V=`struct PostParams {
  bhA: vec4<f32>,
  bhB: vec4<f32>,
  data: vec4<f32>, // worldHalfX, worldHalfY, lensStrength, binaryBlend
};

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var postTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> post: PostParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );

  var out: VSOut;
  out.position = vec4<f32>(p[vertexIndex], 0.0, 1.0);
  out.uv = (p[vertexIndex] + vec2<f32>(1.0, 1.0)) * 0.5;
  return out;
}

fn lens(uv: vec2<f32>, centerUv: vec2<f32>, strength: f32) -> vec2<f32> {
  let d = uv - centerUv;
  let r2 = dot(d, d) + 0.0005;
  return d * (strength / r2);
}

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let worldHalf = post.data.xy;
  let lensStrength = post.data.z;
  let binaryBlend = post.data.w;

  let bhAuv = (post.bhA.xy / worldHalf) * 0.5 + vec2<f32>(0.5, 0.5);
  let bhBuv = (post.bhB.xy / worldHalf) * 0.5 + vec2<f32>(0.5, 0.5);

  var uv = in.uv;
  uv -= lens(uv, bhAuv, lensStrength * post.bhA.z);
  uv -= lens(uv, bhBuv, lensStrength * post.bhB.z * binaryBlend);

  let distToCenter = length(in.uv - 0.5);
  let vignette = 1.0 - smoothstep(0.42, 0.95, distToCenter);
  let color = textureSample(postTexture, postSampler, uv).rgb;
  let starMask = step(0.9955, hash2(floor(in.uv * vec2<f32>(960.0, 540.0))));
  let stars = vec3<f32>(0.08, 0.1, 0.14) + vec3<f32>(0.85, 0.9, 1.0) * starMask * 0.35;
  let accretion = vec3<f32>(1.0, 0.45, 0.12) * pow(max(0.0, 0.2 - distance(in.uv, bhAuv)), 2.0) * 3.0;
  let accretionB = vec3<f32>(0.8, 0.3, 1.0) * pow(max(0.0, 0.16 - distance(in.uv, bhBuv)), 2.0) * 2.0 * binaryBlend;

  return vec4<f32>((color + stars + accretion + accretionB) * max(vignette, 0.18), 1.0);
}
`,m=18e3,k=128,y=1.7,x=1,p=(o,e,t)=>Math.min(Math.max(o,e),t),z=(o,e,t)=>o+(e-o)*t,S=[0,60,140,260,420,620];class F{constructor(){s(this,"up",!1);s(this,"down",!1);s(this,"left",!1);s(this,"right",!1);s(this,"boost",!1);const e=(t,n)=>{const i=t.key.toLowerCase();(i==="w"||i==="arrowup")&&(this.up=n),(i==="s"||i==="arrowdown")&&(this.down=n),(i==="a"||i==="arrowleft")&&(this.left=n),(i==="d"||i==="arrowright")&&(this.right=n),i==="shift"&&(this.boost=n)};window.addEventListener("keydown",t=>e(t,!0)),window.addEventListener("keyup",t=>e(t,!1))}}class H{constructor(e,t,n){s(this,"canvas");s(this,"hud");s(this,"overlay");s(this,"input",new F);s(this,"device");s(this,"context");s(this,"format");s(this,"particleBuffer");s(this,"simUniformBuffer");s(this,"shipUniformBuffer");s(this,"postUniformBuffer");s(this,"statsBuffer");s(this,"statsReadbackBuffer");s(this,"computePipeline");s(this,"particlePipeline");s(this,"shipPipeline");s(this,"postPipeline");s(this,"computeBindGroup");s(this,"particleBindGroup");s(this,"shipBindGroup");s(this,"postBindGroup");s(this,"sceneTexture");s(this,"sceneView");s(this,"postSampler");s(this,"running",!1);s(this,"gameOver",!1);s(this,"shipPos",{x:.72,y:0});s(this,"shipVel",{x:0,y:.34});s(this,"shipHeading",Math.PI);s(this,"shipRadius",.028);s(this,"fuel",100);s(this,"hull",100);s(this,"score",0);s(this,"elapsed",0);s(this,"levelObjective",0);s(this,"objectiveRate",0);s(this,"level",1);s(this,"binaryBlend",0);s(this,"radiationIntensity",0);s(this,"asteroidChaos",0);s(this,"collisionPending",!1);s(this,"awaitingLevelChoice",!1);s(this,"recentHitTimer",0);s(this,"bhA",{x:0,y:0,mass:.052});s(this,"bhB",{x:.45,y:0,mass:.04});s(this,"iscoRadius",.3);s(this,"horizonRadius",.11);s(this,"lastTime",0);this.canvas=e,this.hud=t,this.overlay=n,window.addEventListener("resize",()=>this.resize())}async init(){if(!navigator.gpu)throw new Error("WebGPU is not supported in this browser. Use latest Chrome/Edge with WebGPU enabled.");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("Could not acquire a GPU adapter.");this.device=await e.requestDevice(),this.context=this.canvas.getContext("webgpu"),this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.format,alphaMode:"opaque"}),this.createResources(),this.createPipelines(),this.resize(),this.reset(),requestAnimationFrame(t=>this.frame(t))}createResources(){const t=new Float32Array(m*8);for(let n=0;n<m;n+=1){const i=n%9===0?1:0,r=Math.random()*Math.PI*2,a=this.iscoRadius+.1+Math.random()*.8,h=Math.cos(r)*a,c=Math.sin(r)*a,d=.35+Math.random()*.95,u=-Math.sin(r)*d,B=Math.cos(r)*d,v=i?.003+Math.random()*.004:.0038+Math.random()*.0062,l=n*8;t[l+0]=h,t[l+1]=c,t[l+2]=u,t[l+3]=B,t[l+4]=v,t[l+5]=i,t[l+6]=Math.random(),t[l+7]=1}this.particleBuffer=this.device.createBuffer({size:t.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.particleBuffer,0,t),this.simUniformBuffer=this.device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.shipUniformBuffer=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.postUniformBuffer=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.statsBuffer=this.device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.statsReadbackBuffer=this.device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.postSampler=this.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.createSceneTexture()}createSceneTexture(){var e;(e=this.sceneTexture)==null||e.destroy(),this.sceneTexture=this.device.createTexture({size:[this.canvas.width,this.canvas.height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.sceneView=this.sceneTexture.createView()}createPipelines(){const e=this.device.createShaderModule({code:I}),t=this.device.createShaderModule({code:E}),n=this.device.createShaderModule({code:_}),i=this.device.createShaderModule({code:V});this.computePipeline=this.device.createComputePipeline({layout:"auto",compute:{module:e,entryPoint:"main"}}),this.particlePipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:this.format,blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.shipPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs_main"},fragment:{module:n,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.postPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:i,entryPoint:"vs_main"},fragment:{module:i,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.computeBindGroup=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.simUniformBuffer}},{binding:2,resource:{buffer:this.statsBuffer}}]}),this.particleBindGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.simUniformBuffer}}]}),this.shipBindGroup=this.device.createBindGroup({layout:this.shipPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shipUniformBuffer}}]}),this.postBindGroup=this.device.createBindGroup({layout:this.postPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.postSampler},{binding:1,resource:this.sceneView},{binding:2,resource:{buffer:this.postUniformBuffer}}]})}resize(){const e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));this.canvas.width===t&&this.canvas.height===n||(this.canvas.width=t,this.canvas.height=n,this.device&&(this.createSceneTexture(),this.postBindGroup=this.device.createBindGroup({layout:this.postPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.postSampler},{binding:1,resource:this.sceneView},{binding:2,resource:{buffer:this.postUniformBuffer}}]})))}reset(){this.shipPos={x:.72,y:0},this.shipVel={x:0,y:.34},this.shipHeading=Math.PI,this.fuel=100,this.hull=100,this.score=0,this.elapsed=0,this.levelObjective=0,this.objectiveRate=0,this.level=1,this.binaryBlend=0,this.radiationIntensity=0,this.asteroidChaos=0,this.gameOver=!1,this.awaitingLevelChoice=!1,this.recentHitTimer=0,this.lastTime=0,this.renderStartOverlay()}computeDanger(){const e=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),t=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y),n=Math.min(e,this.binaryBlend>.5?t:Number.POSITIVE_INFINITY);return p((this.iscoRadius-n)/(this.iscoRadius-this.horizonRadius),0,1)}updateDifficulty(e){const t=S[this.level],n=this.level<5&&this.levelObjective>=t?this.level+1:this.level;if(n>this.level){const i=this.level;return this.level=n,this.showLevelPassOverlay(i,n),!0}if(this.radiationIntensity=this.level>=3?p((this.level-2)*.45,0,1.25):0,this.asteroidChaos=this.level>=2?p(.35+(this.level-2)*.25,0,1):0,this.level>=4?this.bhA.mass=.052+(this.elapsed-105)*1e-4:this.bhA.mass=z(this.bhA.mass,.052,.05),this.level>=5){this.binaryBlend=p(this.binaryBlend+e*.35,0,1);const i=this.elapsed*.34;this.bhB.x=Math.cos(i)*.42,this.bhB.y=Math.sin(i)*.28}else this.binaryBlend=p(this.binaryBlend-e*.5,0,1),this.bhB.x=.45,this.bhB.y=0;return!1}updateShip(e){this.recentHitTimer=Math.max(0,this.recentHitTimer-e);const t=Number(this.input.right)-Number(this.input.left),n=Number(this.input.up)-Number(this.input.down),i=Math.hypot(t,n),r=this.input.boost&&this.fuel>0,a=this.computeDanger();let h=0,c=0;if(i>1e-4&&this.fuel>0){const b=(r?1.8:1.05)*(1+a*.65);h=t/i*b,c=n/i*b,this.shipHeading=Math.atan2(c,h)-Math.PI/2;const L=(r?11.5:5)*(1+a*.75+(r?.25:0));this.fuel=Math.max(0,this.fuel-L*e)}const d=this.gravityAt(this.shipPos.x,this.shipPos.y,this.bhA,this.bhA.mass),u=this.gravityAt(this.shipPos.x,this.shipPos.y,this.bhB,this.bhB.mass*this.binaryBlend),v=(this.level>=3?Math.max(0,Math.sin(this.elapsed*1.8+this.level))*this.radiationIntensity:0)*(this.level>=4?2.2:1.1),l=.95+a*.9;this.shipVel.x+=(h*l+d.x+u.x)*e,this.shipVel.y+=(c*l+d.y+u.y)*e,this.shipVel.x*=1-Math.min(.1*e,.06),this.shipVel.y*=1-Math.min(.1*e,.06),this.shipPos.x+=this.shipVel.x*e,this.shipPos.y+=this.shipVel.y*e,this.fuel=Math.max(0,this.fuel-v*e);const P=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),w=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y),A=Math.min(P,this.binaryBlend>.5?w:Number.POSITIVE_INFINITY),f=this.computeDanger();this.score+=e*(1.5+f*30+this.binaryBlend*22);const R=i>1e-4?r?.45:.2:0,g=p((.62-A)/.34,0,1),C=g*g,O=R*(.4+g*1.4+f*1.8),U=this.binaryBlend*(.25+f*.6),M=.03+g*.5+C*2.2+f*3+O+U;if(this.objectiveRate=M,this.levelObjective+=M*e,(P<this.horizonRadius||this.binaryBlend>.45&&w<this.horizonRadius*.95)&&(this.hull=0),this.fuel<=0&&(this.hull-=e*(2+f*14)),(Math.abs(this.shipPos.x)>y*1.1||Math.abs(this.shipPos.y)>x*1.1)&&(this.hull-=e*26),this.recentHitTimer<=0&&this.hull>0){const b=Math.max(.08,.42-f*.24);this.hull=Math.min(100,this.hull+b*e)}}gravityAt(e,t,n,i){const r=n.x-e,a=n.y-t,h=Math.max(r*r+a*a,8e-4),c=1/Math.sqrt(h),d=c*c*c;return{x:r*i*d,y:a*i*d}}uploadUniforms(e){const t=new Float32Array(24);t.set([e,this.elapsed,m,this.level],0),t.set([this.iscoRadius,this.horizonRadius,this.bhA.mass*3.6,this.binaryBlend],4),t.set([this.shipPos.x,this.shipPos.y,this.shipRadius,.18+this.level*.16],8),t.set([this.bhA.x,this.bhA.y,this.bhA.mass*4.4,0],12),t.set([this.bhB.x,this.bhB.y,this.bhB.mass*4.4,0],16),t.set([y,x,this.radiationIntensity,this.asteroidChaos],20),this.device.queue.writeBuffer(this.simUniformBuffer,0,t);const n=new Float32Array(8);n.set([this.shipPos.x,this.shipPos.y,this.shipHeading,this.shipRadius],0),n.set([y,x,this.computeDanger(),this.fuel/100],4),this.device.queue.writeBuffer(this.shipUniformBuffer,0,n);const i=new Float32Array(12);i.set([this.bhA.x,this.bhA.y,this.bhA.mass*3,0],0),i.set([this.bhB.x,this.bhB.y,this.bhB.mass*2.7,0],4),i.set([y,x,19e-5+this.computeDanger()*35e-5,this.binaryBlend],8),this.device.queue.writeBuffer(this.postUniformBuffer,0,i)}frame(e){if(requestAnimationFrame(c=>this.frame(c)),!this.running||this.gameOver)return;if(this.lastTime===0){this.lastTime=e;return}const t=Math.min(.033,(e-this.lastTime)/1e3);if(this.lastTime=e,this.elapsed+=t,this.updateDifficulty(t)){this.drawHud();return}this.updateShip(t),this.uploadUniforms(t),this.device.queue.writeBuffer(this.statsBuffer,0,new Uint32Array([0]));const i=this.device.createCommandEncoder(),r=i.beginComputePass();r.setPipeline(this.computePipeline),r.setBindGroup(0,this.computeBindGroup),r.dispatchWorkgroups(Math.ceil(m/k)),r.end();const a=i.beginRenderPass({colorAttachments:[{view:this.sceneView,clearValue:{r:.01,g:.01,b:.018,a:1},loadOp:"clear",storeOp:"store"}]});a.setPipeline(this.particlePipeline),a.setBindGroup(0,this.particleBindGroup),a.draw(6,m),a.setPipeline(this.shipPipeline),a.setBindGroup(0,this.shipBindGroup),a.draw(6,1),a.end();const h=i.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});h.setPipeline(this.postPipeline),h.setBindGroup(0,this.postBindGroup),h.draw(3,1),h.end(),i.copyBufferToBuffer(this.statsBuffer,0,this.statsReadbackBuffer,0,4),this.device.queue.submit([i.finish()]),this.collisionPending||(this.collisionPending=!0,this.statsReadbackBuffer.mapAsync(GPUMapMode.READ).then(()=>{const d=new Uint32Array(this.statsReadbackBuffer.getMappedRange())[0];if(this.statsReadbackBuffer.unmap(),this.collisionPending=!1,d>0){const u=this.computeDanger();this.recentHitTimer=.8;const v=Math.sqrt(Math.min(d,36))*(.002+u*.006),l=.09+u*.14;this.hull=Math.max(0,this.hull-Math.min(l,v))}}).catch(()=>{this.collisionPending=!1})),this.drawHud(),this.hull<=0&&this.endRun()}drawHud(){const e=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),t=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y),n=Math.min(e,this.binaryBlend>.5?t:Number.POSITIVE_INFINITY),i=n>this.iscoRadius?"Stable Orbit":n>this.horizonRadius?"ISCO Danger Zone":"EVENT HORIZON",r=S[this.level],a=p(this.levelObjective/r*100,0,100);this.hud.textContent=[`Level: ${this.level} / 5`,`Objective: ${this.levelObjective.toFixed(0)} / ${r} (${a.toFixed(0)}%)`,`Objective Rate: ${this.objectiveRate.toFixed(2)} /s`,`Fuel: ${this.fuel.toFixed(1)}%`,`Hull: ${Math.max(this.hull,0).toFixed(1)}%`,`Score: ${Math.floor(this.score)}`,`Closest Radius: ${n.toFixed(3)} (${i})`,`Binary Influence: ${(this.binaryBlend*100).toFixed(0)}%`,`Time Survived: ${this.elapsed.toFixed(1)}s`].join(`
`),this.hud.style.borderColor=this.computeDanger()>.5?"var(--danger)":"#2e3b5a"}endRun(){this.gameOver=!0,this.running=!1,this.overlay.classList.remove("hidden");const e=this.score>3e3?"Legendary pilot":this.score>1500?"Strong run":"Training run";this.overlay.innerHTML=`
      <h1>Mission Lost</h1>
      <p>Final score: <strong>${Math.floor(this.score)}</strong></p>
      <p>${e}. You survived ${this.elapsed.toFixed(1)} seconds.</p>
      <button id="start-btn">Retry</button>
    `;const t=this.overlay.querySelector("#start-btn");t&&t.addEventListener("click",()=>{this.reset(),this.running=!0,this.overlay.classList.add("hidden")})}renderStartOverlay(){this.overlay.innerHTML=`
      <h1>Survive Event Horizon</h1>
      <p>WASD / Arrow keys to thrust. Shift for boost.</p>
      <p>Survive near the ISCO to multiply score, but watch your fuel.</p>
      <button id="start-btn">Start Mission</button>
    `;const e=this.overlay.querySelector("#start-btn");e&&e.addEventListener("click",()=>{this.running=!0,this.overlay.classList.add("hidden")})}showLevelPassOverlay(e,t){if(this.awaitingLevelChoice||e>=5)return;this.awaitingLevelChoice=!0,this.running=!1,this.levelObjective=0,this.overlay.classList.remove("hidden"),this.overlay.innerHTML=`
      <h1>Level ${e} Cleared</h1>
      <p>You passed Level ${e}. Enter Level ${t}?</p>
      <p>Score: <strong>${Math.floor(this.score)}</strong> | Hull: <strong>${Math.max(this.hull,0).toFixed(1)}%</strong></p>
      <div style="display:flex; gap:10px; margin-top: 10px;">
        <button id="continue-btn">Continue</button>
        <button id="exit-btn" style="background: linear-gradient(135deg, #ffd7a1, #ff8b8b);">Exit</button>
      </div>
    `;const n=this.overlay.querySelector("#continue-btn"),i=this.overlay.querySelector("#exit-btn");n&&n.addEventListener("click",()=>{this.awaitingLevelChoice=!1,this.running=!0,this.overlay.classList.add("hidden")}),i&&i.addEventListener("click",()=>{this.awaitingLevelChoice=!1,this.running=!1,this.reset()})}}async function D(){const o=document.querySelector("#game-canvas"),e=document.querySelector("#hud"),t=document.querySelector("#overlay");if(!o||!e||!t)throw new Error("Required DOM nodes were not found.");const n=new H(o,e,t);try{await n.init()}catch(i){const r=i instanceof Error?i.message:"Unknown initialization error";t.classList.remove("hidden"),t.innerHTML=`
      <h1>WebGPU Init Failed</h1>
      <p>${r}</p>
      <p>Use latest Chrome/Edge and enable hardware acceleration.</p>
    `}}D();
