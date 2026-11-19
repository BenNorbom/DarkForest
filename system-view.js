import { orbit } from './flight.mjs';

export function mountSystem(root, data, options) {
  root.innerHTML =
    '<header class="orb-head"><div><small class="section-label">Orbital observatory</small><h2></h2></div><time></time></header><div class="orb-tools"><label>Record<select class="record"></select></label><label>Perspective<select class="perspective"></select></label><label>Follow<select class="follow"></select></label></div><canvas tabindex="0" aria-label="Three-dimensional orbital chart. Drag or use arrow keys to orbit. Scroll or use plus and minus to zoom."></canvas><div class="orb-transport"><button type="button">Play</button><input type="range" aria-label="Encounter time" min="0" step="1"><output></output><button class="next-contact" type="button">Next event</button></div><div class="orb-readout"><section><h3>Flight record</h3><ol></ol></section><section><h3>System intelligence</h3><div class="telemetry"></div></section></div><details class="orb-mail"><summary>Controller correspondence</summary><ul></ul></details>';
  const q = (s) => root.querySelector(s),
    canvas = q('canvas'),
    g = canvas.getContext('2d');
  q('h2').textContent = data.name;
  const makeOption = (select, label, value) => select.add(new Option(label, value));
  makeOption(q('.record'), 'Current system', 'now');
  for (const t of [...data.history].reverse())
    makeOption(q('.record'), options.date(t.start) + ' · local traffic', t.start);
  q('.record').value = data.start ?? 'now';
  q('.record').onchange = (e) =>
    options.change(e.target.value === 'now' ? -1 : +e.target.value, options.controller);
  makeOption(q('.perspective'), options.local ? 'Local receiver' : 'All observations', '');
  for (const c of new Map(data.controllers.map((c) => [c.id, c])).values())
    makeOption(q('.perspective'), c.doctrine + ' · ' + c.id, c.id);
  q('.perspective').disabled = options.local;
  q('.perspective').value = options.controller || '';
  q('.perspective').onchange = (e) => options.change(data.start ?? -1, e.target.value);
  makeOption(q('.follow'), 'System center', '');
  let trackMenu = '';
  const frames = data.frames,
    range = q('input'),
    button = q('.orb-transport button');
  range.max = Math.max(0, frames.length - 1);
  range.value = 0;
  range.disabled = button.disabled = frames.length < 2;
  let yaw = 0.45,
    pitch = 0.78,
    zoom = 1,
    drag = null,
    timer;
  const sky = Array.from({ length: 510 }, (_, i) => [
    (i * 0.61803398875) % 1,
    (i * i * 0.41421356237) % 1,
    (i % 7) / 8,
  ]);
  const colors = ['#a6e8db', '#e9aa74', '#a6a1ef'];
  const line = (a, b, color, width = 1) => {
    g.beginPath();
    g.moveTo(...a);
    g.lineTo(...b);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  function draw() {
    const rect = canvas.getBoundingClientRect(),
      w = rect.width,
      h = rect.height,
      dpr = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ix = +range.value,
      f = frames[ix],
      time = f?.time ?? data.month,
      followed = f?.ships.find((s) => s.id === q('.follow').value);
    const known = f?.ships || [];
    const ids = known.map((s) => s.id).join('|');
    if (ids !== trackMenu) {
      const select = q('.follow'),
        current = select.value;
      select.replaceChildren(new Option('System center', ''));
      for (const ship of known) makeOption(select, ship.role + ' · ' + ship.id, ship.id);
      select.value = known.some((s) => s.id === current) ? current : '';
      trackMenu = ids;
    }
    const focus = followed?.p || [0, 0, 0],
      k = Math.min(w / (f ? 11.8 : 8.7), h / (f ? 8 : 5.8)) * zoom;
    function project(p) {
      const [x, y, z] = p.map((n, i) => n - focus[i]),
        u = x * Math.cos(yaw) - y * Math.sin(yaw),
        v = x * Math.sin(yaw) + y * Math.cos(yaw);
      return [w / 2 + u * k, h / 2 + (v * Math.cos(pitch) - z * Math.sin(pitch)) * k];
    }
    g.fillStyle = '#081321';
    g.fillRect(0, 0, w, h);
    for (const [x, y, m] of sky) {
      g.fillStyle = 'rgba(176,210,236,' + (0.18 + m * 0.52) + ')';
      g.fillRect(x * w, y * h, 0.65 + m, 0.65 + m);
    }
    const [cx, cy] = project([0, 0, 0]);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(34, k * 2.4));
    glow.addColorStop(0, 'rgba(255,196,127,.34)');
    glow.addColorStop(0.17, 'rgba(212,143,89,.12)');
    glow.addColorStop(1, 'transparent');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    const bodies = data.layout.bodies;
    for (const [j, b] of bodies.entries()) {
      const period = 12 * Math.sqrt(b.radius ** 3 / data.layout.mass);
      g.beginPath();
      for (let n = 0; n <= 120; n++) {
        const xy = project(orbit(data.layout, j, time + (n * period) / 120).p);
        if (!n) g.moveTo(...xy);
        else g.lineTo(...xy);
      }
      g.strokeStyle = colors[j] + '55';
      g.lineWidth = 0.9;
      g.stroke();
    }
    function sphere(x, y, r, c) {
      const light = g.createRadialGradient(x - r * 0.35, y - r * 0.45, 0, x, y, r);
      light.addColorStop(0, '#fffae8');
      light.addColorStop(0.32, c);
      light.addColorStop(1, '#182236');
      g.fillStyle = light;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Small debris shares the mining belt's orbital plane.
    const belt = bodies[2],
      period = 12 * Math.sqrt(belt.radius ** 3 / data.layout.mass);
    for (let i = 0; i < 250; i++) {
      const p = orbit(data.layout, 2, time + period * ((i * 0.6180339) % 1)).p;
      const r = 0.98 + 0.045 * Math.sin(i * 1.38);
      const [x, y] = project(p.map((n) => n * r));
      g.fillStyle = i % 6 ? '#9b99bf55' : '#cec7ed88';
      g.fillRect(x, y, i % 6 ? 1 : 1.7, 1);
    }
    const corona = g.createRadialGradient(cx, cy, 1, cx, cy, 24);
    corona.addColorStop(0, '#fff1ba');
    corona.addColorStop(0.25, '#ffc477dc');
    corona.addColorStop(0.55, '#ffb96d33');
    corona.addColorStop(1, '#ffb96d00');
    g.fillStyle = corona;
    g.fillRect(cx - 24, cy - 24, 48, 48);
    sphere(cx, cy, 5, '#ffe8a0');
    const drawn = bodies
      .map((b, j) => ({ b, j, p: orbit(data.layout, j, time).p }))
      .sort((a, b) => a.p[2] - b.p[2]);
    for (const { b, j, p } of drawn) {
      const [x, y] = project(p);
      sphere(x, y, [8, 5, 4][j], colors[j]);
      if (!f && data.station === j) {
        g.strokeStyle = '#b2d8df';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.arc(x, y, 16, 0, 2 * Math.PI);
        g.stroke();
        g.setLineDash([]);
      }
      line([x + 5, y - 5], [x + 15, y - 16], colors[j] + '88');
      g.fillStyle = colors[j];
      g.font = '11px system-ui';
      g.fillText(b.name, x + 18, y - 14);
    }
    for (const ship of f?.ships || []) {
      const color = options.colors.find((c) => c.owner === ship.owner)?.color || '#a8dae7';
      let last;
      for (let j = Math.max(0, ix - 22); j <= ix; j++) {
        const prev = frames[j].ships.find((x) => x.id === ship.id);
        if (!prev) {
          last = null;
          continue;
        }
        const pos = project(prev.p);
        if (last) line(last, pos, color + '80', 1.3);
        last = pos;
      }
      const [x, y] = project(ship.p),
        velocity = project(ship.p.map((n, i) => n + ship.v[i]));
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(velocity[1] - y, velocity[0] - x));
      g.beginPath();
      if (ship.role === 'Battery') {
        g.rect(-3.5, -3.5, 7, 7);
      } else {
        g.moveTo(6, 0);
        g.lineTo(-4, 3);
        g.lineTo(-2, 0);
        g.lineTo(-4, -3);
      }
      g.closePath();
      g.fillStyle = ship.hull === 0 ? '#696772' : color;
      g.fill();
      g.restore();
      if (followed?.id === ship.id) {
        g.strokeStyle = color;
        g.beginPath();
        g.arc(x, y, 12, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = color;
        g.font = '11px system-ui';
        g.fillText(ship.role, x + 15, y - 10);
      }
    }
    const recent = data.events.filter((e) => e.time <= time);
    for (const e of recent.slice(-24))
      if (time - e.time <= 0.125 && e.kind === 'pulse' && e.to)
        line(project(e.at), project(e.to), '#ffc892', 1.5);
    const scaleWidth = k * (zoom > 2 ? 0.5 : 1);
    line([16, h - 15], [16 + scaleWidth, h - 15], '#8da7b4');
    g.font = '10px monospace';
    g.fillStyle = '#bfd4d8';
    g.fillText(zoom > 2 ? '0.5 AU' : '1 AU', 16, h - 22);
    const date = options.date(Math.floor(time));
    q('time').textContent = date;
    q('output').textContent = f ? 'Month ' + time.toFixed(2) : 'Orbital positions';
    q('.orb-transport').hidden = !f;
    const log = q('ol');
    log.replaceChildren();
    for (const e of recent.slice(-4).reverse()) {
      const li = document.createElement('li');
      li.textContent = e.description + ' · ' + e.ship;
      log.append(li);
    }
    if (!log.children.length)
      log.textContent = f
        ? 'Awaiting first contact.'
        : data.history.length
          ? 'Choose a traffic record to follow an expedition.'
          : 'No expeditions recorded here by this date.';
    const mail = data.messages
        .filter((m) => m.time <= time)
        .slice(-12)
        .reverse(),
      mailList = q('.orb-mail ul');
    q('.orb-mail').hidden = !mail.length;
    mailList.replaceChildren(
      ...mail.map((m) => {
        const li = document.createElement('li');
        li.textContent = options.date(m.time) + ' · ' + m.status + ' · ' + m.source;
        return li;
      }),
    );
    const readout = q('.telemetry');
    readout.replaceChildren();
    const row = (a, b) => {
      const p = document.createElement('p'),
        strong = document.createElement('strong');
      strong.textContent = b;
      p.append(a, strong);
      readout.append(p);
    };
    if (followed) {
      row('Ship', followed.role);
      row('Commander', followed.controller ?? 'Unidentified');
      row('Order', followed.objective ?? 'Unknown');
      if (followed.doctrine) row('Doctrine', followed.doctrine);
      row('Maneuver', followed.action ?? 'Observed track');
      if (followed.clock != null) row('Ship clock', (followed.clock / 12).toFixed(2) + ' yr');
      if (followed.evidence != null) row('Acquired tracks', followed.evidence);
      if (followed.drive != null)
        row(
          'Drive / sensors',
          Math.round(followed.drive * 100) + '% / ' + Math.round(followed.sensor * 100) + '%',
        );
      if (followed.burn != null) row('Thrust', followed.burn.toFixed(2) + ' AU/mo²');
      if (followed.fuel != null) row('Maneuver reserve', Math.round((followed.fuel / 16) * 100) + '%');
      if (followed.hull != null) row('Hull', Math.round(100 * followed.hull) + '%');
    } else {
      row('Stellar mass', data.layout.mass.toFixed(2) + ' M☉');
      row('Observed ships', String(f?.ships.length || 0));
      if (data.profile && data.profile.born <= time) {
        row(
          data.profile.promoted != null && data.profile.promoted <= time ? 'Local ruler' : 'Controller',
          data.profile.id,
        );
        if (data.profile.parent) row('Commissioned by', data.profile.parent);
      }
      if (!f && data.station != null) row('Defense station', bodies[data.station].name);
      if (!f && data.facilities)
        row('Production', data.facilities.slice(1).every(Boolean) ? 'Operational' : 'Disrupted');
      for (const m of data.messages.filter((m) => m.time <= time).slice(-1))
        row('Correspondence', m.status);
    }
  }
  function pause() {
    clearInterval(timer);
    timer = null;
    button.textContent = 'Play';
  }
  button.onclick = () => {
    if (timer) return pause();
    if (+range.value >= +range.max) range.value = 0;
    button.textContent = 'Pause';
    timer = setInterval(() => {
      range.value = +range.value + 1;
      draw();
      if (+range.value >= +range.max) pause();
    }, 100);
  };
  q('.next-contact').onclick = () => {
    pause();
    const t = frames[+range.value]?.time ?? 0;
    const event = data.events.find(
      (e) => e.time > t && ['contact', 'impact', 'outcome', 'maneuver'].includes(e.kind),
    );
    const next = event ? frames.findIndex((f) => f.time >= event.time) : -1;
    range.value = next < 0 ? range.max : next;
    draw();
  };
  range.oninput = () => {
    pause();
    draw();
  };
  q('.follow').onchange = draw;
  canvas.onpointerdown = (e) => {
    drag = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag[0]) * 0.009;
    pitch = Math.max(-1.53, Math.min(1.53, pitch + (e.clientY - drag[1]) * 0.009));
    drag = [e.clientX, e.clientY];
    draw();
  };
  canvas.onlostpointercapture = () => {
    drag = null;
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    zoom = Math.max(0.4, Math.min(12, zoom * Math.exp(-e.deltaY * 0.002)));
    draw();
  };
  canvas.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'Home'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Home') {
      zoom = 1;
      pitch = 0.78;
      yaw = 0.45;
    } else if (e.key === '+' || e.key === '-')
      zoom = Math.max(0.4, Math.min(12, zoom * (e.key === '+' ? 1.2 : 1 / 1.2)));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      yaw += e.key === 'ArrowLeft' ? -0.15 : 0.15;
    else pitch = Math.max(-1.53, Math.min(1.53, pitch + (e.key === 'ArrowUp' ? 0.15 : -0.15)));
    draw();
  };
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);
  draw();
  return () => {
    pause();
    resize.disconnect();
  };
}
