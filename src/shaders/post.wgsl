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
