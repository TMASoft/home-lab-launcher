class Scheduler {
  constructor() {
    this.jobs = new Map();
  }

  addInterval(name, task, { intervalMs, initialDelayMs = intervalMs, runOnStart = false } = {}) {
    if (!name) throw new Error('Scheduled job name is required');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error(`Invalid interval for scheduled job ${name}`);
    if (this.jobs.has(name)) this.stop(name);
    const state = {
      name,
      intervalMs,
      initialDelayMs,
      status: 'scheduled',
      runCount: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      nextRunAt: null,
      timeout: null,
      interval: null
    };
    const run = async () => {
      state.status = 'running';
      state.lastRunAt = new Date().toISOString();
      state.runCount += 1;
      try {
        await task();
        state.status = 'scheduled';
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = null;
      } catch (error) {
        state.status = 'error';
        state.lastErrorAt = new Date().toISOString();
        state.lastError = error?.message || String(error);
        console.error(`Scheduled job ${name} failed:`, error);
      } finally {
        state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      }
    };
    const startInterval = () => {
      state.interval = setInterval(run, intervalMs);
      state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    };
    this.jobs.set(name, { state, run });
    if (runOnStart) {
      run();
      startInterval();
    } else {
      state.nextRunAt = new Date(Date.now() + initialDelayMs).toISOString();
      state.timeout = setTimeout(() => {
        state.timeout = null;
        run();
        startInterval();
      }, initialDelayMs);
    }
    return state;
  }

  stop(name) {
    const job = this.jobs.get(name);
    if (!job) return false;
    if (job.state.timeout) clearTimeout(job.state.timeout);
    if (job.state.interval) clearInterval(job.state.interval);
    job.state.status = 'stopped';
    job.state.nextRunAt = null;
    this.jobs.delete(name);
    return true;
  }

  stopAll() {
    for (const name of [...this.jobs.keys()]) this.stop(name);
  }

  list() {
    return [...this.jobs.values()].map(({ state }) => ({
      name: state.name,
      intervalMs: state.intervalMs,
      status: state.status,
      runCount: state.runCount,
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      lastErrorAt: state.lastErrorAt,
      lastError: state.lastError,
      nextRunAt: state.nextRunAt
    }));
  }
}

module.exports = { Scheduler };
