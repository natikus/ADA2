// servicio para exponer métricas de stamps desde el router
import express from 'express';

const app = express();
const port = 3004; // puerto para stampsz

// métricas por stamp
const stampCounters = {
  s1: 0,
  s2: 0,
  default: 0
};

app.get('/stampsz', (req, res) => {
  res.json({
    total_requests: stampCounters.s1 + stampCounters.s2 + stampCounters.default,
    by_stamp: stampCounters,
    stamp_ids: ['s1', 's2', 'default']
  });
});

// endpoint para que el router reporte hits
app.post('/report/:stamp', (req, res) => {
  const stamp = req.params.stamp;
  if (stampCounters[stamp] !== undefined) {
    stampCounters[stamp]++;
  }
  res.json({ ok: true, stamp, count: stampCounters[stamp] });
});

app.listen(port, () => {
  console.log(`Stamps metrics server on http://localhost:${port}/stampsz`);
});

export default app;
