struct ShipParams {
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
