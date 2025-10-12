export const batchRequests = async <T>(
  items: T[],
  processor: (item: T, index: number) => Promise<any>,
  batchSize: number = 3,
  delayBetweenBatches: number = 1000
): Promise<any[]> => {
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map((item, index) => processor(item, i + index));
    
    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches to respect rate limits
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  return results;
};