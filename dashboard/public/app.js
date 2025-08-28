async function update() {
  try {
    const current = await fetch('/api/current').then(r => r.json());
    document.getElementById('co2').textContent = current.co2 ?? '-';
    document.getElementById('temp').textContent = current.temperature ?? '-';
    document.getElementById('hum').textContent = current.humidity ?? '-';

    const history = await fetch('/api/history').then(r => r.json());
    const labels = history.map(p => new Date(p._time).toLocaleTimeString());
    const data = history.map(p => p._value);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
  } catch (err) {
    console.error(err);
  }
}

const ctx = document.getElementById('chart');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{ label: 'CO2 ppm', data: [], borderColor: '#3e95cd' }]
  },
  options: { responsive: true, maintainAspectRatio: false }
});

update();
setInterval(update, 60000);
