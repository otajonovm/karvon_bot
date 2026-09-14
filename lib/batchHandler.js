/**
 * OPTIMIZED ASYNC BATCH HANDLER
 * 
 * Purpose: Handle large batches of async operations with:
 * - Configurable concurrency (Telegram rate limit: ~30 msg/sec)
 * - Exponential backoff on failures
 * - Memory-safe processing
 * 
 * Usage:
 *   const results = await batchProcess(items, asyncFn, { concurrency: 5 });
 */

/**
 * Process array of items in batches with concurrency limit
 * 
 * @param {Array} items - Items to process
 * @param {Function} asyncFn - Async function that processes one item
 * @param {Object} options - Configuration
 * @param {number} options.concurrency - Max parallel operations (default: 5)
 * @param {number} options.retries - Max retries per item (default: 2)
 * @param {boolean} options.stopOnError - Stop batch on first error (default: false)
 * @returns {Promise<Array>} Results array with { item, result, error, retryCount }
 */
async function batchProcess(items, asyncFn, options = {}) {
  const {
    concurrency = 5,
    retries = 2,
    stopOnError = false,
    onProgress = null,
  } = options;

  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  const results = [];
  let activeCount = 0;
  let processedCount = 0;
  const errors = [];

  // Queue of items to process
  const queue = [...items];
  let shouldStop = false;

  async function processItem(item, retryCount = 0) {
    try {
      const result = await asyncFn(item);
      results.push({ item, result, error: null, retryCount });
      processedCount++;
      
      if (onProgress) {
        onProgress({
          processed: processedCount,
          total: items.length,
          item,
          status: 'success',
        });
      }

      return { success: true, result };
    } catch (error) {
      if (retryCount < retries) {
        // Exponential backoff: 100ms, 200ms, 400ms...
        const delay = Math.pow(2, retryCount) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        return processItem(item, retryCount + 1);
      }

      errors.push(error);
      results.push({ item, result: null, error, retryCount });
      processedCount++;

      if (onProgress) {
        onProgress({
          processed: processedCount,
          total: items.length,
          item,
          status: 'failed',
          error: error.message,
        });
      }

      if (stopOnError) {
        shouldStop = true;
      }

      return { success: false, error };
    }
  }

  async function workerLoop() {
    while (queue.length > 0 && !shouldStop) {
      const item = queue.shift();
      if (!item) break;

      activeCount++;
      
      // Don't wait, let it process in background
      processItem(item).finally(() => {
        activeCount--;
      });

      // Wait for slot to open up
      while (activeCount >= concurrency && !shouldStop) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  // Start workers
  await workerLoop();

  // Wait for all active tasks to complete
  while (activeCount > 0 && !shouldStop) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    results,
    successCount: results.filter(r => !r.error).length,
    failureCount: results.filter(r => r.error).length,
    errors,
  };
}

/**
 * Telegram-safe batch push with rate limiting
 * Respects Telegram's rate limit (~30 messages/second)
 * 
 * @param {Function} sendFn - Async function to send message: async (driver) => msg
 * @param {Array} drivers - Drivers to notify
 * @param {Object} options - Configuration
 * @returns {Promise<Object>} Results
 */
async function batchPushTelegram(sendFn, drivers, options = {}) {
  const {
    batchSize = 5,
    delayMs = 150,
    onPushComplete = null,
  } = options;

  if (!Array.isArray(drivers) || drivers.length === 0) {
    return { sent: 0, failed: 0, results: [] };
  }

  const results = [];
  let sentCount = 0;
  let failedCount = 0;

  // Process in small batches
  for (let i = 0; i < drivers.length; i += batchSize) {
    const batch = drivers.slice(i, i + batchSize);
    
    // Send batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map(async (driver, idx) => {
        // Stagger within batch
        if (idx > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs * idx));
        }
        return sendFn(driver);
      })
    );

    // Process results
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const driver = batch[j];

      if (result.status === 'fulfilled') {
        sentCount++;
        results.push({ driver, success: true, message: result.value });
      } else {
        failedCount++;
        results.push({ driver, success: false, error: result.reason });
      }
    }

    if (onPushComplete) {
      onPushComplete({
        sent: sentCount,
        failed: failedCount,
        total: drivers.length,
        batchNum: Math.floor(i / batchSize) + 1,
      });
    }

    // Delay between batches to respect rate limits
    if (i + batchSize < drivers.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    sent: sentCount,
    failed: failedCount,
    results,
  };
}

/**
 * Memory-safe iterator for large arrays
 * Processes items one at a time, suitable for large datasets
 */
async function* asyncIterator(items, asyncFn) {
  for (const item of items) {
    try {
      const result = await asyncFn(item);
      yield { item, result, error: null };
    } catch (error) {
      yield { item, result: null, error };
    }
  }
}

module.exports = {
  batchProcess,
  batchPushTelegram,
  asyncIterator,
};
