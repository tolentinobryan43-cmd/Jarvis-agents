// Dot-matrix sphere + orbital tracks, rendered on canvas.
(function () {
  const canvas = document.getElementById('globe');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const N = 3400;
  const TILT = -0.38;
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, i });
  }

  // A handful of points promoted to "nodes" with a ping cycle.
  const nodes = [];
  for (let k = 0; k < 7; k++) {
    nodes.push({ p: pts[Math.floor((k * 397 + 101) % N)], phase: Math.random() * Math.PI * 2 });
  }

  const rings = [
    { r: 1.26, inc: 0.55, spin: 0.00042, n: 190 },
    { r: 1.46, inc: -0.34, spin: -0.00029, n: 220 },
    { r: 1.68, inc: 0.18, spin: 0.00018, n: 250 },
  ];

  let W = 0, H = 0, R = 0, DPR = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R = Math.min(W, H) * 0.315;
  }

  function project(p, cos, sin) {
    const x = p.x * cos - p.z * sin;
    const z0 = p.x * sin + p.z * cos;
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    const y = p.y * ct - z0 * st;
    const z = p.y * st + z0 * ct;
    return { x, y, z };
  }

  let rot = 0;
  let t = 0;

  function frame() {
    rot += 0.0019;
    t += 1;
    const cx = W / 2, cy = H / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    ctx.clearRect(0, 0, W, H);

    // --- static reticle rings ---
    ctx.strokeStyle = 'rgba(120, 190, 235, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.92, 0, Math.PI * 2); ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot * 2.1);
    ctx.setLineDash([2, 10]);
    ctx.strokeStyle = 'rgba(150, 215, 255, 0.3)';
    ctx.beginPath(); ctx.arc(0, 0, R * 2.05, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // tick rail
    ctx.strokeStyle = 'rgba(150, 215, 255, 0.34)';
    for (let a = 0; a < 360; a += 6) {
      const long = a % 30 === 0;
      const rad = (a * Math.PI) / 180;
      const r1 = R * 1.78;
      const r2 = r1 + (long ? 9 : 4);
      ctx.globalAlpha = long ? 0.75 : 0.32;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
      ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- orbital tracks (behind) ---
    drawRings(cx, cy, cos, sin, -1);

    // --- sphere points ---
    for (let i = 0; i < N; i++) {
      const q = project(pts[i], cos, sin);
      const depth = (q.z + 1) / 2;
      const sx = cx + q.x * R;
      const sy = cy + q.y * R;
      if (q.z >= 0) {
        const a = 0.3 + depth * 0.7;
        const s = depth > 0.72 ? 1.9 : 1.35;
        ctx.fillStyle = 'rgba(196, 234, 255,' + a.toFixed(3) + ')';
        ctx.fillRect(sx, sy, s, s);
      } else {
        ctx.fillStyle = 'rgba(96, 150, 190,' + (0.06 + depth * 0.16).toFixed(3) + ')';
        ctx.fillRect(sx, sy, 1, 1);
      }
    }

    // --- nodes + pings ---
    for (const nd of nodes) {
      const q = project(nd.p, cos, sin);
      if (q.z < 0.05) continue;
      const sx = cx + q.x * R;
      const sy = cy + q.y * R;
      const pulse = (Math.sin(t * 0.03 + nd.phase) + 1) / 2;

      ctx.fillStyle = 'rgba(232, 248, 255, 0.95)';
      ctx.fillRect(sx - 1, sy - 1, 2.6, 2.6);

      ctx.strokeStyle = 'rgba(160, 220, 255,' + (0.5 - pulse * 0.45).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + pulse * 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- orbital tracks (front) ---
    drawRings(cx, cy, cos, sin, 1);

    requestAnimationFrame(frame);
  }

  function drawRings(cx, cy, cos, sin, side) {
    for (let k = 0; k < rings.length; k++) {
      const ring = rings[k];
      const spin = rot * (ring.spin * 1400);
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + spin;
        const px = Math.cos(a) * ring.r;
        const pz = Math.sin(a) * ring.r;
        const ci = Math.cos(ring.inc), si = Math.sin(ring.inc);
        const p = { x: px, y: pz * si, z: pz * ci };
        const q = project(p, cos, sin);
        if (side > 0 ? q.z < 0 : q.z >= 0) continue;
        const depth = (q.z + 1) / 2;
        ctx.fillStyle = 'rgba(150, 212, 255,' + (0.1 + depth * 0.5).toFixed(3) + ')';
        ctx.fillRect(cx + q.x * R, cy + q.y * R, 1.25, 1.25);
      }
    }
  }

  window.addEventListener('resize', resize);
  resize();
  frame();
})();
