struct PostParams {
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

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var pp = p;
  for (var i = 0; i < 4; i = i + 1) {
    v += noise2(pp) * amp;
    pp *= 2.03;
    amp *= 0.5;
  }
  return v;
}

fn sampleLensedColor(uv: vec2<f32>, shift: vec2<f32>) -> vec3<f32> {
  let r = textureSample(postTexture, postSampler, uv + shift).r;
  let g = textureSample(postTexture, postSampler, uv).g;
  let b = textureSample(postTexture, postSampler, uv - shift).b;
  return vec3<f32>(r, g, b);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let worldHalf = post.data.xy;
  let lensStrength = post.data.z;
  let binaryBlend = post.data.w;
  let time = post.bhA.w;

  let bhAuv = (post.bhA.xy / worldHalf) * 0.5 + vec2<f32>(0.5, 0.5);
  let bhBuv = (post.bhB.xy / worldHalf) * 0.5 + vec2<f32>(0.5, 0.5);

  var uv = in.uv;
  let lensA = lens(uv, bhAuv, lensStrength * post.bhA.z);
  let lensB = lens(uv, bhBuv, lensStrength * post.bhB.z * binaryBlend);
  uv -= lensA;
  uv -= lensB;

  let distToCenter = length(in.uv - 0.5);
  let vignette = 1.0 - smoothstep(0.42, 0.95, distToCenter);
  let distortion = length(lensA + lensB);
  let color = sampleLensedColor(uv, vec2<f32>(distortion * 0.03, 0.0));
  let starMask = step(0.9955, hash2(floor(in.uv * vec2<f32>(960.0, 540.0))));
  let stars = vec3<f32>(0.08, 0.1, 0.14) + vec3<f32>(0.85, 0.9, 1.0) * starMask * 0.35;

  let relA = in.uv - bhAuv;
  let rA = length(relA);
  let phiA = atan2(relA.y, relA.x);
  let warpA = fbm(relA * 34.0 + vec2<f32>(time * 0.12, -time * 0.08));
  let diskA = exp(-pow((rA - 0.14 - warpA * 0.01) * 38.0, 2.0));
  let beamingA = 0.55 + 0.45 * sin(phiA * 2.0 + time * 0.9);
  let accretionA = vec3<f32>(1.0, 0.5, 0.16) * diskA * (0.7 + beamingA * 1.2);
  let photonRingA = vec3<f32>(1.0, 0.86, 0.62) * exp(-pow((rA - 0.09) * 82.0, 2.0)) * 1.4;

  let relB = in.uv - bhBuv;
  let rB = length(relB);
  let phiB = atan2(relB.y, relB.x);
  let warpB = fbm(relB * 36.0 + vec2<f32>(-time * 0.1, time * 0.09));
  let diskB = exp(-pow((rB - 0.11 - warpB * 0.008) * 34.0, 2.0));
  let beamingB = 0.5 + 0.5 * sin(phiB * 2.0 - time * 0.8);
  let accretionB = vec3<f32>(0.75, 0.34, 1.0) * diskB * (0.65 + beamingB) * binaryBlend;
  let photonRingB = vec3<f32>(0.95, 0.68, 1.0) * exp(-pow((rB - 0.075) * 78.0, 2.0)) * binaryBlend;

  let jetA = exp(-pow(abs(relA.x) * 40.0, 1.6)) * smoothstep(0.05, 0.35, abs(relA.y)) * 0.26;
  let jetB = exp(-pow(abs(relB.x) * 44.0, 1.7)) * smoothstep(0.04, 0.28, abs(relB.y)) * 0.2 * binaryBlend;
  let jets = vec3<f32>(0.42, 0.62, 1.0) * jetA + vec3<f32>(0.7, 0.45, 1.0) * jetB;

  let bloom = vec3<f32>(1.0, 0.6, 0.28) * pow(max(0.0, 0.23 - rA), 2.2) * 1.8;
  let bloomB = vec3<f32>(0.9, 0.4, 1.0) * pow(max(0.0, 0.2 - rB), 2.2) * binaryBlend * 1.4;

  let finalColor = color + stars + accretionA + accretionB + photonRingA + photonRingB + jets + bloom + bloomB;
  return vec4<f32>(finalColor * max(vignette, 0.18), 1.0);
}
