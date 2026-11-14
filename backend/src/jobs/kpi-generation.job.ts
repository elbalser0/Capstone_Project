import { generateDueKpis } from '../services/kpi.service.js';

const HOUR = 60 * 60 * 1000;

// Generates KPIs for cycles whose feedback deadline has passed: once at startup, then every
// hour, so KPIs appear shortly after a deadline even if the server was down at the time.
// Returns a function that stops the job.
export function startKpiGeneration(run: () => Promise<unknown> = generateDueKpis, intervalMs = HOUR) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    run()
      // Avoid logging connection credentials or raw database errors.
      .catch(() => console.error('KPI generation failed; it will try again in an hour.'))
      .finally(() => { running = false; });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
