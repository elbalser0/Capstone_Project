import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { startKpiGeneration } from '../src/jobs/kpi-generation.job.js';

const HOUR = 60 * 60 * 1000;
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('KPI generation runs at startup and then every hour until stopped', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let runs = 0;
    const stop = startKpiGeneration(async () => { runs += 1; });
    assert.equal(runs, 1);

    await settle();
    mock.timers.tick(HOUR);
    assert.equal(runs, 2);
    await settle();
    mock.timers.tick(HOUR);
    assert.equal(runs, 3);

    await settle();
    stop();
    mock.timers.tick(HOUR);
    assert.equal(runs, 3);
  } finally {
    mock.timers.reset();
  }
});

test('a failed run is logged without the error and the next run still happens', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const logged = mock.method(console, 'error', () => {});
  try {
    let runs = 0;
    const stop = startKpiGeneration(async () => {
      runs += 1;
      if (runs === 1) throw new Error('postgresql://user:secret@host/db refused');
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logged.mock.callCount(), 1);
    assert.doesNotMatch(String(logged.mock.calls[0].arguments.join(' ')), /secret/);

    mock.timers.tick(HOUR);
    assert.equal(runs, 2);
    stop();
  } finally {
    logged.mock.restore();
    mock.timers.reset();
  }
});

test('a run still going when the next one is due is not started twice', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let runs = 0;
    let finish = () => {};
    const stop = startKpiGeneration(() => {
      runs += 1;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    mock.timers.tick(HOUR);
    assert.equal(runs, 1);

    finish();
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(HOUR);
    assert.equal(runs, 2);
    stop();
  } finally {
    mock.timers.reset();
  }
});
