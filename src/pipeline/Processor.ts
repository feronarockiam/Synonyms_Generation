import pLimit from 'p-limit';
import { Extractor } from './Extractor';
import { Batcher } from './Batcher';
import { Writer } from './Writer';
import { CacheManager } from '../storage/CacheManager';
import { CheckpointManager } from '../storage/CheckpointManager';
import { QueueManager } from '../storage/QueueManager';
import { globalGroqClient } from '../clients/groqClient';
import { globalClaudeClient } from '../clients/claudeClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SearchableTerm, CacheEntry, GroqResponseType } from '../types';
import crypto from 'crypto';

export class Processor {
  private extractor = new Extractor();
  private cache: CacheManager;
  private writer: Writer;
  private checkpointConfig: CheckpointManager;

  // p-limit allows limiting concurrent promises
  private limit = pLimit(config.pipeline.concurrency);

  constructor() {
    this.cache = new CacheManager(config.paths.cache);
    this.writer = new Writer(config.paths.output);
    this.checkpointConfig = new CheckpointManager(config.paths.checkpoint);
    logger.info(`Processor initialized (Provider: ${config.pipeline.provider}, Cache: ${config.paths.cache}, Output: ${config.paths.output})`);
  }

  public async process(inputPath: string, ignoreCheckpoint: boolean, dryRun: boolean) {
    if (ignoreCheckpoint) {
      this.cache.clear();
    }
    const queueManager = new QueueManager();
    
    let checkpoint = this.checkpointConfig.getCheckpoint();
    if (!dryRun) {
      checkpoint = this.checkpointConfig.initialize(inputPath, ignoreCheckpoint);
    }
    
    const stats = { ...checkpoint.stats };
    let currentIndex = 0;
    
    const batcher = new Batcher();
    const promises: Promise<void>[] = [];
    
    for await (const { index, term } of this.extractor.streamCSV(inputPath)) {
      currentIndex = index;
      
      if (!dryRun && index <= checkpoint.lastProcessedIndex && !ignoreCheckpoint) {
        continue;
      }
      
      if (!term) continue;
      
      // Fast bypass using Cache
      if (this.cache.has(term.hash)) {
        logger.debug(`Cache hit for ${term.canonical}. Skipping API call.`);
        stats.success++;
        
        if (!dryRun) {
          const cachedResult = this.cache.get(term.hash);
          if (cachedResult) {
            this.writer.append(cachedResult);
          }
        }
        continue;
      }
      
      const { isFull, batch } = batcher.add(term);
      if (isFull && batch) {
        promises.push(this.limit(() => this.processBatchWithRetry(batch, queueManager, stats, dryRun)));
      }
      
      if (!dryRun && stats.success % config.pipeline.checkpointInterval === 0 && stats.success > 0) {
        this.checkpointConfig.update(currentIndex, stats);
        this.checkpointConfig.flush();
        this.cache.flush();
      }
    }
    
    const remaining = batcher.flush();
    if (remaining.length > 0) {
      promises.push(this.limit(() => this.processBatchWithRetry(remaining, queueManager, stats, dryRun)));
    }
    
    await Promise.all(promises);
    
    if (!dryRun) {
      this.checkpointConfig.update(currentIndex, stats);
      this.checkpointConfig.flush();
      this.cache.flush();
      logger.info(`Processing completed. Total: ${stats.total}, Success: ${stats.success}, Failed: ${stats.failed}`);
    } else {
      logger.info('Dry Run completed successfully.');
    }
  }

  public async processFailed(retryFailed: boolean, queueManager: QueueManager, dryRun: boolean) {
    if (!retryFailed) return;
    const failedTerms = queueManager.getAll();
    logger.info(`Retrying ${failedTerms.length} failed terms.`);
    // Simplified retry logic for now
  }

  private async processBatchWithRetry(batch: SearchableTerm[], queueManager: QueueManager, stats: any, dryRun: boolean) {
    if (dryRun) {
      logger.info(`[DryRun] Would call LLM provider [${config.pipeline.provider}] for ${batch.length} terms.`);
      return;
    }

    try {
      await this.processBatch(batch, queueManager, stats);
    } catch (e: any) {
      if (e?.status === 413) {
        const half = Math.ceil(batch.length / 2);
        if (half === batch.length) {
          this.markBatchFailed(batch, queueManager, stats, e.message);
          return;
        }
        await this.processBatchWithRetry(batch.slice(0, half), queueManager, stats, dryRun);
        await this.processBatchWithRetry(batch.slice(half), queueManager, stats, dryRun);
      } else {
        this.markBatchFailed(batch, queueManager, stats, e.message);
      }
    }
  }

  private async processBatch(batch: SearchableTerm[], queueManager: QueueManager, stats: any): Promise<void> {
    const provider = config.pipeline.provider;
    let response: GroqResponseType | null;

    if (provider === 'claude') {
      response = await globalClaudeClient.enrichTerms(batch);
    } else {
      response = await globalGroqClient.enrichTerms(batch);
    }

    if (!response || !response.results) return;

    for (const res of response.results) {
      const orig = batch.find(b => b.canonical.toLowerCase() === res.concept.toLowerCase());
      if (orig) {
        if (!res.searchable) {
          logger.info(`Term marked as non-searchable: ${res.concept}`);
          stats.total++;
          continue;
        }

        const cacheEntry: CacheEntry = {
          hash: orig.hash,
          canonical: res.concept,
          type: orig.type,
          searchable: res.searchable,
          exact_synonyms: res.exact_synonyms,
          query_expansions: res.query_expansions || [],
          negative_terms: res.negative_terms || [],
          processedAt: new Date().toISOString(),
          requestId: crypto.randomUUID()
        };

        this.cache.set(orig.hash, cacheEntry);
        this.writer.append(cacheEntry);
        stats.success++;
        stats.total++;
      } else {
        logger.warn(`AI returned concept mismatch: ${res.concept}. Expected one of: ${batch.map(b => b.canonical).join(', ')}`);
      }
    }
  }

  private markBatchFailed(batch: SearchableTerm[], queueManager: QueueManager, stats: any, errorMsg: string) {
    stats.failed += batch.length;
    stats.total += batch.length;
    for (const b of batch) {
       queueManager.add({ 
         term: b.canonical, 
         error: errorMsg, 
         attempts: config.groq.maxRetries, 
         lastAttemptAt: new Date().toISOString() 
       });
    }
  }
}
