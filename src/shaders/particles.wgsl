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
