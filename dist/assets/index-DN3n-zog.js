var P=Object.defineProperty;var w=(o,t,e)=>t in o?P(o,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):o[t]=e;var s=(o,t,e)=>w(o,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function e(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(i){if(i.ep)return;i.ep=!0;const r=e(i);fetch(i.href,r)}})();const S=`struct SimParams {
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

  let bhA = sim.v3.xy;
  let massA = sim.v3.z;
  let bhB = sim.v4.xy;
  let massB = sim.v4.z;

  var a = gravityAccel(pos, bhA, massA);
  a += gravityAccel(pos, bhB, massB) * binaryBlend;

  // Mild drag keeps trajectories from exploding numerically over long sessions.
  vel = (vel + a * dt) * (1.0 - min(0.12 * dt, 0.08));
  pos = pos + vel * dt;

  let shipPos = sim.v2.xy;
  let shipRadius = sim.v2.z;
  let collisionScale = sim.v2.w;
  let deltaShip = pos - shipPos;
  let shipDist = length(deltaShip);
  if (shipDist < shipRadius + radius) {
    atomicAdd(&stats.collisionCount, 1u);
    // Bounce and damp when hitting the ship to make impact visible.
    let n = normalize(select(vec2<f32>(0.0, 1.0), deltaShip, shipDist > 0.0001));
    vel = reflect(vel, n) * 0.5;
    pos = shipPos + n * (shipRadius + radius + 0.002);
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
    let spawnR = sim.v1.x + 0.12 + hash(seed + 3.1) * 0.85;
    let side = select(-1.0, 1.0, hash(seed + 9.2) > 0.5);
    let anchor = mix(bhA, bhB, binaryBlend * step(0.5, hash(seed + 7.3)));

    pos = anchor + vec2<f32>(cos(angle), sin(angle)) * spawnR * vec2<f32>(1.0, side);
    let tangent = normalize(vec2<f32>(-(pos.y - anchor.y), pos.x - anchor.x));
    vel = tangent * (0.35 + hash(seed + 4.7) * 0.9);

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
`,M=`struct SimParams {
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
`,A=`struct ShipParams {
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
`,U=`struct PostParams {
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
`,u=18e3,R=128,v=1.7,m=1,f=(o,t,e)=>Math.min(Math.max(o,t),e),G=(o,t,e)=>o+(t-o)*e;class O{constructor(){s(this,"up",!1);s(this,"down",!1);s(this,"left",!1);s(this,"right",!1);s(this,"boost",!1);const t=(e,n)=>{const i=e.key.toLowerCase();(i==="w"||i==="arrowup")&&(this.up=n),(i==="s"||i==="arrowdown")&&(this.down=n),(i==="a"||i==="arrowleft")&&(this.left=n),(i==="d"||i==="arrowright")&&(this.right=n),i==="shift"&&(this.boost=n)};window.addEventListener("keydown",e=>t(e,!0)),window.addEventListener("keyup",e=>t(e,!1))}}class C{constructor(t,e,n){s(this,"canvas");s(this,"hud");s(this,"overlay");s(this,"input",new O);s(this,"device");s(this,"context");s(this,"format");s(this,"particleBuffer");s(this,"simUniformBuffer");s(this,"shipUniformBuffer");s(this,"postUniformBuffer");s(this,"statsBuffer");s(this,"statsReadbackBuffer");s(this,"computePipeline");s(this,"particlePipeline");s(this,"shipPipeline");s(this,"postPipeline");s(this,"computeBindGroup");s(this,"particleBindGroup");s(this,"shipBindGroup");s(this,"postBindGroup");s(this,"sceneTexture");s(this,"sceneView");s(this,"postSampler");s(this,"running",!1);s(this,"gameOver",!1);s(this,"shipPos",{x:.72,y:0});s(this,"shipVel",{x:0,y:.34});s(this,"shipHeading",Math.PI);s(this,"shipRadius",.028);s(this,"fuel",100);s(this,"hull",100);s(this,"score",0);s(this,"elapsed",0);s(this,"level",1);s(this,"binaryBlend",0);s(this,"radiationIntensity",0);s(this,"collisionPending",!1);s(this,"bhA",{x:0,y:0,mass:.052});s(this,"bhB",{x:.45,y:0,mass:.04});s(this,"iscoRadius",.3);s(this,"horizonRadius",.11);s(this,"lastTime",0);this.canvas=t,this.hud=e,this.overlay=n,window.addEventListener("resize",()=>this.resize())}async init(){if(!navigator.gpu)throw new Error("WebGPU is not supported in this browser. Use latest Chrome/Edge with WebGPU enabled.");const t=await navigator.gpu.requestAdapter();if(!t)throw new Error("Could not acquire a GPU adapter.");this.device=await t.requestDevice(),this.context=this.canvas.getContext("webgpu"),this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.format,alphaMode:"opaque"}),this.createResources(),this.createPipelines(),this.resize(),this.reset(),requestAnimationFrame(e=>this.frame(e))}createResources(){const e=new Float32Array(u*8);for(let n=0;n<u;n+=1){const i=n%9===0?1:0,r=Math.random()*Math.PI*2,a=this.iscoRadius+.1+Math.random()*.8,l=Math.cos(r)*a,h=Math.sin(r)*a,c=.35+Math.random()*.95,y=-Math.sin(r)*c,g=Math.cos(r)*c,p=i?.004+Math.random()*.005:.006+Math.random()*.01,d=n*8;e[d+0]=l,e[d+1]=h,e[d+2]=y,e[d+3]=g,e[d+4]=p,e[d+5]=i,e[d+6]=Math.random(),e[d+7]=1}this.particleBuffer=this.device.createBuffer({size:e.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.particleBuffer,0,e),this.simUniformBuffer=this.device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.shipUniformBuffer=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.postUniformBuffer=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.statsBuffer=this.device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.statsReadbackBuffer=this.device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.postSampler=this.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.createSceneTexture()}createSceneTexture(){var t;(t=this.sceneTexture)==null||t.destroy(),this.sceneTexture=this.device.createTexture({size:[this.canvas.width,this.canvas.height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.sceneView=this.sceneTexture.createView()}createPipelines(){const t=this.device.createShaderModule({code:S}),e=this.device.createShaderModule({code:M}),n=this.device.createShaderModule({code:A}),i=this.device.createShaderModule({code:U});this.computePipeline=this.device.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:"main"}}),this.particlePipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.format,blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.shipPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs_main"},fragment:{module:n,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.postPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:i,entryPoint:"vs_main"},fragment:{module:i,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.computeBindGroup=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.simUniformBuffer}},{binding:2,resource:{buffer:this.statsBuffer}}]}),this.particleBindGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.simUniformBuffer}}]}),this.shipBindGroup=this.device.createBindGroup({layout:this.shipPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shipUniformBuffer}}]}),this.postBindGroup=this.device.createBindGroup({layout:this.postPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.postSampler},{binding:1,resource:this.sceneView},{binding:2,resource:{buffer:this.postUniformBuffer}}]})}resize(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.floor(this.canvas.clientWidth*t)),n=Math.max(1,Math.floor(this.canvas.clientHeight*t));this.canvas.width===e&&this.canvas.height===n||(this.canvas.width=e,this.canvas.height=n,this.device&&(this.createSceneTexture(),this.postBindGroup=this.device.createBindGroup({layout:this.postPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.postSampler},{binding:1,resource:this.sceneView},{binding:2,resource:{buffer:this.postUniformBuffer}}]})))}reset(){this.shipPos={x:.72,y:0},this.shipVel={x:0,y:.34},this.shipHeading=Math.PI,this.fuel=100,this.hull=100,this.score=0,this.elapsed=0,this.level=1,this.binaryBlend=0,this.radiationIntensity=0,this.gameOver=!1,this.lastTime=0,this.renderStartOverlay()}computeDanger(){const t=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),e=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y),n=Math.min(t,this.binaryBlend>.5?e:Number.POSITIVE_INFINITY);return f((this.iscoRadius-n)/(this.iscoRadius-this.horizonRadius),0,1)}updateDifficulty(t){if(this.level=f(Math.floor(this.elapsed/35)+1,1,5),this.radiationIntensity=this.level>=3?f((this.level-2)*.45,0,1.25):0,this.level>=4?this.bhA.mass=.052+(this.elapsed-105)*1e-4:this.bhA.mass=G(this.bhA.mass,.052,.05),this.level>=5){this.binaryBlend=f(this.binaryBlend+t*.35,0,1);const e=this.elapsed*.34;this.bhB.x=Math.cos(e)*.42,this.bhB.y=Math.sin(e)*.28}else this.binaryBlend=f(this.binaryBlend-t*.5,0,1),this.bhB.x=.45,this.bhB.y=0}updateShip(t){const e=Number(this.input.right)-Number(this.input.left),n=Number(this.input.up)-Number(this.input.down),i=Math.hypot(e,n),r=this.input.boost&&this.fuel>0;let a=0,l=0;if(i>1e-4&&this.fuel>0){const b=r?1.7:1;a=e/i*b,l=n/i*b,this.shipHeading=Math.atan2(l,a)-Math.PI/2;const B=r?10.8:5.2;this.fuel=Math.max(0,this.fuel-B*t)}const h=this.gravityAt(this.shipPos.x,this.shipPos.y,this.bhA,this.bhA.mass),c=this.gravityAt(this.shipPos.x,this.shipPos.y,this.bhB,this.bhB.mass*this.binaryBlend),g=(this.level>=3?Math.max(0,Math.sin(this.elapsed*1.8+this.level))*this.radiationIntensity:0)*(this.level>=4?2.2:1.1);this.shipVel.x+=(a*.8+h.x+c.x)*t,this.shipVel.y+=(l*.8+h.y+c.y)*t,this.shipVel.x*=1-Math.min(.1*t,.06),this.shipVel.y*=1-Math.min(.1*t,.06),this.shipPos.x+=this.shipVel.x*t,this.shipPos.y+=this.shipVel.y*t,this.fuel=Math.max(0,this.fuel-g*t);const p=this.computeDanger();this.score+=t*(6+p*26+this.binaryBlend*18);const d=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),x=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y);(d<this.horizonRadius||this.binaryBlend>.45&&x<this.horizonRadius*.95)&&(this.hull=0),this.fuel<=0&&(this.hull-=t*(2+p*14)),(Math.abs(this.shipPos.x)>v*1.1||Math.abs(this.shipPos.y)>m*1.1)&&(this.hull-=t*26)}gravityAt(t,e,n,i){const r=n.x-t,a=n.y-e,l=Math.max(r*r+a*a,8e-4),h=1/Math.sqrt(l),c=h*h*h;return{x:r*i*c,y:a*i*c}}uploadUniforms(t){const e=new Float32Array(24);e.set([t,this.elapsed,u,this.level],0),e.set([this.iscoRadius,this.horizonRadius,this.bhA.mass*3.6,this.binaryBlend],4),e.set([this.shipPos.x,this.shipPos.y,this.shipRadius,.18+this.level*.16],8),e.set([this.bhA.x,this.bhA.y,this.bhA.mass*4.4,0],12),e.set([this.bhB.x,this.bhB.y,this.bhB.mass*4.4,0],16),e.set([v,m,this.radiationIntensity,0],20),this.device.queue.writeBuffer(this.simUniformBuffer,0,e);const n=new Float32Array(8);n.set([this.shipPos.x,this.shipPos.y,this.shipHeading,this.shipRadius],0),n.set([v,m,this.computeDanger(),this.fuel/100],4),this.device.queue.writeBuffer(this.shipUniformBuffer,0,n);const i=new Float32Array(12);i.set([this.bhA.x,this.bhA.y,this.bhA.mass*3,0],0),i.set([this.bhB.x,this.bhB.y,this.bhB.mass*2.7,0],4),i.set([v,m,19e-5+this.computeDanger()*35e-5,this.binaryBlend],8),this.device.queue.writeBuffer(this.postUniformBuffer,0,i)}frame(t){if(requestAnimationFrame(l=>this.frame(l)),!this.running||this.gameOver)return;if(this.lastTime===0){this.lastTime=t;return}const e=Math.min(.033,(t-this.lastTime)/1e3);this.lastTime=t,this.elapsed+=e,this.updateDifficulty(e),this.updateShip(e),this.uploadUniforms(e),this.device.queue.writeBuffer(this.statsBuffer,0,new Uint32Array([0]));const n=this.device.createCommandEncoder(),i=n.beginComputePass();i.setPipeline(this.computePipeline),i.setBindGroup(0,this.computeBindGroup),i.dispatchWorkgroups(Math.ceil(u/R)),i.end();const r=n.beginRenderPass({colorAttachments:[{view:this.sceneView,clearValue:{r:.01,g:.01,b:.018,a:1},loadOp:"clear",storeOp:"store"}]});r.setPipeline(this.particlePipeline),r.setBindGroup(0,this.particleBindGroup),r.draw(6,u),r.setPipeline(this.shipPipeline),r.setBindGroup(0,this.shipBindGroup),r.draw(6,1),r.end();const a=n.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});a.setPipeline(this.postPipeline),a.setBindGroup(0,this.postBindGroup),a.draw(3,1),a.end(),n.copyBufferToBuffer(this.statsBuffer,0,this.statsReadbackBuffer,0,4),this.device.queue.submit([n.finish()]),this.collisionPending||(this.collisionPending=!0,this.statsReadbackBuffer.mapAsync(GPUMapMode.READ).then(()=>{const h=new Uint32Array(this.statsReadbackBuffer.getMappedRange())[0];if(this.statsReadbackBuffer.unmap(),this.collisionPending=!1,h>0){const c=this.computeDanger();this.hull=Math.max(0,this.hull-h*(.01+c*.028))}}).catch(()=>{this.collisionPending=!1})),this.drawHud(),this.hull<=0&&this.endRun()}drawHud(){const t=Math.hypot(this.shipPos.x-this.bhA.x,this.shipPos.y-this.bhA.y),e=Math.hypot(this.shipPos.x-this.bhB.x,this.shipPos.y-this.bhB.y),n=Math.min(t,this.binaryBlend>.5?e:Number.POSITIVE_INFINITY),i=n>this.iscoRadius?"Stable Orbit":n>this.horizonRadius?"ISCO Danger Zone":"EVENT HORIZON";this.hud.textContent=[`Level: ${this.level} / 5`,`Fuel: ${this.fuel.toFixed(1)}%`,`Hull: ${Math.max(this.hull,0).toFixed(1)}%`,`Score: ${Math.floor(this.score)}`,`Closest Radius: ${n.toFixed(3)} (${i})`,`Binary Influence: ${(this.binaryBlend*100).toFixed(0)}%`,`Time Survived: ${this.elapsed.toFixed(1)}s`].join(`
`),this.hud.style.borderColor=this.computeDanger()>.5?"var(--danger)":"#2e3b5a"}endRun(){this.gameOver=!0,this.running=!1,this.overlay.classList.remove("hidden");const t=this.score>3e3?"Legendary pilot":this.score>1500?"Strong run":"Training run";this.overlay.innerHTML=`
      <h1>Mission Lost</h1>
      <p>Final score: <strong>${Math.floor(this.score)}</strong></p>
      <p>${t}. You survived ${this.elapsed.toFixed(1)} seconds.</p>
      <button id="start-btn">Retry</button>
    `;const e=this.overlay.querySelector("#start-btn");e&&e.addEventListener("click",()=>{this.reset(),this.running=!0,this.overlay.classList.add("hidden")})}renderStartOverlay(){this.overlay.innerHTML=`
      <h1>Survive Event Horizon</h1>
      <p>WASD / Arrow keys to thrust. Shift for boost.</p>
      <p>Survive near the ISCO to multiply score, but watch your fuel.</p>
      <button id="start-btn">Start Mission</button>
    `;const t=this.overlay.querySelector("#start-btn");t&&t.addEventListener("click",()=>{this.running=!0,this.overlay.classList.add("hidden")})}}async function T(){const o=document.querySelector("#game-canvas"),t=document.querySelector("#hud"),e=document.querySelector("#overlay");if(!o||!t||!e)throw new Error("Required DOM nodes were not found.");const n=new C(o,t,e);try{await n.init()}catch(i){const r=i instanceof Error?i.message:"Unknown initialization error";e.classList.remove("hidden"),e.innerHTML=`
      <h1>WebGPU Init Failed</h1>
      <p>${r}</p>
      <p>Use latest Chrome/Edge and enable hardware acceleration.</p>
    `}}T();
