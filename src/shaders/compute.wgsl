struct SimParams {
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
