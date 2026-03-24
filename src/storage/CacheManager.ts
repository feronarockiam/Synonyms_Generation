import fs from 'fs';
import { CacheEntry } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private cachePath: string;

  constructor(cachePath: string = config.paths.cache) {
    this.cachePath = cachePath;
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.cachePath)) {
      try {
        const data = fs.readFileSync(this.cachePath, 'utf8');
        const parsed: Record<string, CacheEntry> = JSON.parse(data);
        for (const [hash, entry] of Object.entries(parsed)) {
          this.cache.set(hash, entry);
        }
        logger.info(`Loaded ${this.cache.size} entries from cache.`);
      } catch (err: any) {
        logger.error(`Failed to load cache: ${err.message}`);
        // If file is corrupted, we start with an empty cache but don't overwrite until we flush
      }
    }
  }

  public get(hash: string): CacheEntry | undefined {
    return this.cache.get(hash);
  }

  public set(hash: string, entry: CacheEntry): void {
    this.cache.set(hash, entry);
  }

  public has(hash: string): boolean {
    return this.cache.has(hash);
  }

  public clear(): void {
    this.cache.clear();
    logger.info('Cache cleared.');
  }

  public flush(): void {
    try {
      const obj = Object.fromEntries(this.cache.entries());
      const tempPath = `${this.cachePath}.tmp`;
      
      // Atomic write
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(tempPath, this.cachePath);
      logger.debug(`Flushed ${this.cache.size} entries to cache.`);
    } catch (err: any) {
      logger.error(`Failed to flush cache: ${err.message}`);
    }
  }
}

// Removed globalCache singleton to allow dynamic configuration
