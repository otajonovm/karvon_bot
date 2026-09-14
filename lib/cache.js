/**
 * MEMORY CACHE LAYER (node-cache)
 * 
 * Purpose: Reduce database queries by caching:
 * - Active drivers list (60 sec TTL)
 * - Admin statistics (90 sec TTL)
 * - User subscriptions (120 sec TTL)
 * - Driver profiles (150 sec TTL)
 * 
 * Trade-off: Slightly stale data (max 2.5 min) vs 50% query reduction
 */

const NodeCache = require('node-cache');

// Standard TTL values (in seconds)
const CACHE_TTL = {
  DRIVERS_ACTIVE: 60,        // Active drivers list - update frequently
  ADMIN_STATS: 90,           // Admin dashboard - less frequent
  USER_SUBSCRIPTION: 120,    // User subscription status
  DRIVER_PROFILE: 150,       // Driver profile data
  REGIONS_SUMMARY: 180,      // Regional summary
  PAYMENTS_PENDING: 60,      // Pending payments
};

// Initialize cache with max 1000 items, check expired every 120 sec
const cache = new NodeCache({ 
  stdTTL: 60, 
  checkperiod: 120,
  maxKeys: 1000,
  useClones: true, // Deep clone to prevent external mutations
});

// Monitor cache stats
cache.on('expired', (key, value) => {
  if (process.env.DEBUG_CACHE) {
    console.log(`[cache] ⏰ Expired: ${key}`);
  }
});

cache.on('del', (key, value) => {
  if (process.env.DEBUG_CACHE) {
    console.log(`[cache] 🗑️ Deleted: ${key}`);
  }
});

/**
 * Get or set cached value with async function
 * @param {string} key - Cache key
 * @param {function} fetchFn - Async function to fetch data if not cached
 * @param {number} ttl - Time to live in seconds (optional)
 * @returns {Promise} Cached or fetched data
 */
async function getOrFetch(key, fetchFn, ttl = CACHE_TTL.DRIVERS_ACTIVE) {
  try {
    // Check cache first
    const cached = cache.get(key);
    if (cached !== undefined) {
      if (process.env.DEBUG_CACHE) {
        console.log(`[cache] ✅ HIT: ${key}`);
      }
      return cached;
    }

    // Cache miss - fetch data
    if (process.env.DEBUG_CACHE) {
      console.log(`[cache] ❌ MISS: ${key}`);
    }
    const data = await fetchFn();
    
    // Store in cache
    cache.set(key, data, ttl);
    return data;
  } catch (error) {
    console.error(`[cache] Error for key "${key}":`, error.message);
    throw error;
  }
}

/**
 * Manually invalidate cache for a key
 */
function invalidate(key) {
  cache.del(key);
  console.log(`[cache] 🔄 Invalidated: ${key}`);
}

/**
 * Invalidate all keys matching pattern
 */
function invalidatePattern(pattern) {
  const keys = cache.keys();
  const regex = new RegExp(pattern);
  let count = 0;
  
  keys.forEach(key => {
    if (regex.test(key)) {
      cache.del(key);
      count++;
    }
  });
  
  console.log(`[cache] 🔄 Invalidated ${count} keys matching "${pattern}"`);
  return count;
}

/**
 * Clear all cache
 */
function clear() {
  cache.flushAll();
  console.log('[cache] 🧹 All cache cleared');
}

/**
 * Get cache statistics
 */
function getStats() {
  const keys = cache.keys();
  return {
    keys: keys.length,
    itemsRemaining: cache.getStats().ksize,
    vsize: cache.getStats().vsize,
    hitrate: cache.getStats().hits / (cache.getStats().hits + cache.getStats().misses),
  };
}

/**
 * Cache invalidation hooks
 */
const invalidationHooks = {
  // When driver status changes, invalidate active drivers list
  onDriverStatusChange: (driverId) => {
    invalidatePattern('^drivers:active');
    invalidate('admin:stats');
  },

  // When order is created/taken, invalidate admin stats
  onOrderChange: () => {
    invalidate('admin:stats');
    invalidatePattern('^orders:');
  },

  // When payment is processed, invalidate stats
  onPaymentChange: () => {
    invalidate('admin:stats');
    invalidate('payments:pending');
  },

  // When user subscription changes, invalidate that user's cache
  onSubscriptionChange: (userId) => {
    invalidate(`user:subscription:${userId}`);
    invalidate('admin:stats');
  },
};

module.exports = {
  CACHE_TTL,
  getOrFetch,
  invalidate,
  invalidatePattern,
  clear,
  getStats,
  invalidationHooks,
  cache, // Export raw cache for advanced usage
};
