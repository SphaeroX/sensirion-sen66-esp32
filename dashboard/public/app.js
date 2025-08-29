function getSelectedFields() {
  return Array.from(document.querySelectorAll('input.field:checked')).map(i => i.value);
}

function buildSeries(rows, selected) {
  const byField = new Map();
  for (const f of selected) byField.set(f, []);
  for (const r of rows) {
    if (!byField.has(r._field)) continue;
    byField.get(r._field).push({ x: new Date(r._time).getTime(), y: r._value });
  }
  const palette = {
    co2: '#e74c3c',
    temperature: '#f39c12',
    humidity: '#3498db',
    dew_point: '#5dade2',
    pm1_0: '#1abc9c',
    pm2_5: '#9b59b6',
    pm4_0: '#2c3e50',
    pm10: '#8e44ad',
    voc: '#2ecc71',
    nox: '#16a085',
    nc0_5: '#d35400',
    nc1_0: '#c0392b',
    nc2_5: '#7f8c8d',
    nc4_0: '#95a5a6',
    nc10: '#34495e'
  };
  return selected.map(f => ({ name: f, data: byField.get(f) || [], color: palette[f] }));
}

async function fetchCurrent() {
  const [current, iaq] = await Promise.all([
    fetch('/api/current').then(r => r.json()),
    fetch('/api/iaq/current').then(r => r.json())
  ]);
  document.getElementById('co2').textContent = current.co2 ?? '-';
  document.getElementById('temp').textContent = current.temperature ?? '-';
  document.getElementById('hum').textContent = current.humidity ?? '-';
  document.getElementById('dew').textContent = current.dew_point ?? '-';
  const iaqVal = iaq && typeof iaq.iaq === 'number' ? iaq.iaq : null;
  document.getElementById('iaq').textContent = iaqVal != null ? Math.round(iaqVal) : '-';
}

async function fetchAndRender() {
  const preset = document.getElementById('preset').value;
  const customRange = document.getElementById('range-input').value.trim();
  const range = preset === 'custom' ? (customRange || '-24h') : preset;
  const every = document.getElementById('every').value;
  const fields = getSelectedFields();
  const baseFields = fields.filter(f => f !== 'iaq');
  const params = new URLSearchParams({ range });
  if (baseFields.length) params.set('fields', baseFields.join(','));
  if (every) params.set('every', every);

  const promises = [];
  if (baseFields.length) promises.push(fetch(`/api/history?${params.toString()}`).then(r => r.json()));
  else promises.push(Promise.resolve([]));
  if (fields.includes('iaq')) {
    const p = new URLSearchParams({ range }); if (every) p.set('every', every);
    promises.push(fetch(`/api/iaq/history?${p.toString()}`).then(r => r.json()));
  } else {
    promises.push(Promise.resolve([]));
  }

  const [rowsBase, rowsIaq] = await Promise.all(promises);
  const rows = [...rowsBase, ...rowsIaq];
  const series = buildSeries(rows, fields);
  chart.updateSeries(series);
}

const chart = new ApexCharts(document.querySelector('#chart'), {
  chart: { type: 'line', height: '100%', animations: { enabled: true } },
  series: [],
  stroke: { width: 2, curve: 'smooth' },
  xaxis: { type: 'datetime' },
  yaxis: [
    { labels: { formatter: (v) => v.toFixed(0) } }
  ],
  legend: { position: 'top', horizontalAlign: 'left' },
  tooltip: { shared: true, x: { format: 'dd.MM HH:mm' } }
});

chart.render();

// Controls
document.getElementById('preset').addEventListener('change', (e) => {
  const isCustom = e.target.value === 'custom';
  document.getElementById('custom-range').classList.toggle('hidden', !isCustom);
});
document.getElementById('refresh').addEventListener('click', () => {
  fetchAndRender().catch(console.error);
});
document.querySelectorAll('input.field').forEach(cb => cb.addEventListener('change', () => {
  fetchAndRender().catch(console.error);
}));

async function tick() {
  try {
    await fetchCurrent();
    await fetchAndRender();
  } catch (e) {
    console.error(e);
  }
}

// Initial load (defaults to -24h)
tick();
setInterval(tick, 60000);
