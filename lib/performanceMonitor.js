/**
 * PERFORMANCE MONITORING & METRICS
 * 
 * Tracks:
 * - Database query times
 * - Push notification timing
 * - Cache hit/miss rates
 * - Memory usage
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      queries: [],
      pushes: [],
      cacheStats: { hits: 0, misses: 0 },
      memoryPeaks: [],
    };
    this.thresholds = {
      query_warn: 100,   // ms
      query_error: 500,  // ms
      push_warn: 2000,   // ms
      push_error: 5000,  // ms
    };
  }

  /**
   * Track database query timing
   */
  trackQuery(name, duration, size = 0) {
    const metric = {
      timestamp: Date.now(),
      name,
      duration,
      size,
      status: this._getStatus(duration, 'query'),
    };

    this.metrics.queries.push(metric);
    
    if (this.metrics.queries.length > 1000) {
      this.metrics.queries.shift(); // Keep last 1000
    }

    if (metric.status !== 'ok') {
      console.log(
        `[perf] ${metric.status.toUpperCase()} — ${name}: ${duration}ms (${size} rows)`
      );
    }

    return metric;
  }

  /**
   * Track push notification timing
   */
  trackPush(driverId, duration, status) {
    const metric = {
      timestamp: Date.now(),
      driverId,
      duration,
      status: status === 'success' ? 'ok' : 'fail',
      severity: this._getStatus(duration, 'push'),
    };

    this.metrics.pushes.push(metric);
    
    if (this.metrics.pushes.length > 500) {
      this.metrics.pushes.shift(); // Keep last 500
    }

    return metric;
  }

  /**
   * Track cache statistics
   */
  trackCacheHit(key) {
    this.metrics.cacheStats.hits++;
  }

  trackCacheMiss(key) {
    this.metrics.cacheStats.misses++;
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    const peak = Math.max(...this.metrics.memoryPeaks, usage.heapUsed);
    
    this.metrics.memoryPeaks.push(usage.heapUsed);
    if (this.metrics.memoryPeaks.length > 100) {
      this.metrics.memoryPeaks.shift();
    }

    return {
      heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
      peakHeap: `${(peak / 1024 / 1024).toFixed(2)} MB`,
    };
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const queries = this.metrics.queries;
    const pushes = this.metrics.pushes;
    const cache = this.metrics.cacheStats;

    const getAvg = (arr, field) => 
      arr.length === 0 ? 0 : arr.reduce((sum, x) => sum + x[field], 0) / arr.length;

    const getPercentile = (arr, field, p) => {
      if (arr.length === 0) return 0;
      const sorted = arr.map(x => x[field]).sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * (p / 100));
      return sorted[idx];
    };

    const totalHits = cache.hits + cache.misses;
    const hitRate = totalHits === 0 ? 0 : ((cache.hits / totalHits) * 100).toFixed(1);

    return {
      queries: {
        total: queries.length,
        avgTime: getAvg(queries, 'duration').toFixed(2),
        p95Time: getPercentile(queries, 'duration', 95).toFixed(2),
        p99Time: getPercentile(queries, 'duration', 99).toFixed(2),
        warnings: queries.filter(q => q.status === 'warn').length,
        errors: queries.filter(q => q.status === 'error').length,
      },
      pushes: {
        total: pushes.length,
        success: pushes.filter(p => p.status === 'ok').length,
        failed: pushes.filter(p => p.status === 'fail').length,
        avgTime: getAvg(pushes, 'duration').toFixed(2),
      },
      cache: {
        hits: cache.hits,
        misses: cache.misses,
        totalRequests: totalHits,
        hitRate: `${hitRate}%`,
      },
      memory: this.getMemoryUsage(),
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      queries: [],
      pushes: [],
      cacheStats: { hits: 0, misses: 0 },
      memoryPeaks: [],
    };
  }

  /**
   * Print performance report
   */
  printReport() {
    const summary = this.getSummary();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   KARVON PERFORMANCE REPORT            ║');
    console.log('╚════════════════════════════════════════╝');
    
    console.log('\n📊 QUERIES:');
    console.log(`   Total: ${summary.queries.total}`);
    console.log(`   Avg: ${summary.queries.avgTime}ms`);
    console.log(`   P95: ${summary.queries.p95Time}ms | P99: ${summary.queries.p99Time}ms`);
    console.log(`   ⚠️  Warnings: ${summary.queries.warnings} | ❌ Errors: ${summary.queries.errors}`);

    console.log('\n📤 PUSH NOTIFICATIONS:');
    console.log(`   Total: ${summary.pushes.total}`);
    console.log(`   ✅ Success: ${summary.pushes.success} | ❌ Failed: ${summary.pushes.failed}`);
    console.log(`   Avg Time: ${summary.pushes.avgTime}ms`);

    console.log('\n💾 CACHE:');
    console.log(`   Hits: ${summary.cache.hits} | Misses: ${summary.cache.misses}`);
    console.log(`   Hit Rate: ${summary.cache.hitRate}`);

    console.log('\n🧠 MEMORY:');
    console.log(`   Heap: ${summary.memory.heapUsed} / ${summary.memory.heapTotal}`);
    console.log(`   Peak: ${summary.memory.peakHeap}`);
    console.log(`   RSS: ${summary.memory.rss}\n`);
  }

  _getStatus(duration, type) {
    const threshold = this.thresholds[`${type}_error`];
    const warn = this.thresholds[`${type}_warn`];
    
    if (duration >= threshold) return 'error';
    if (duration >= warn) return 'warn';
    return 'ok';
  }
}

// Global singleton
let instance = null;

function getMonitor() {
  if (!instance) {
    instance = new PerformanceMonitor();
  }
  return instance;
}

// Auto-print report every 5 minutes (in debug mode)
if (process.env.PERF_MONITOR) {
  setInterval(() => {
    getMonitor().printReport();
  }, 5 * 60 * 1000);
}

module.exports = {
  PerformanceMonitor,
  getMonitor,
};
