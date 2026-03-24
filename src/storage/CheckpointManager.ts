import fs from 'fs';
import { Checkpoint } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class CheckpointManager {
  private checkpointPath: string;
  private currentCheckpoint: Checkpoint;

  constructor(checkpointPath: string = config.paths.checkpoint) {
    this.checkpointPath = checkpointPath;
    this.currentCheckpoint = this.createDefaultCheckpoint('');
  }

  public initialize(inputFilePath: string, ignoreCheckpoint: boolean = false): Checkpoint {
    const inputHash = this.hashFile(inputFilePath);

    if (!ignoreCheckpoint && fs.existsSync(this.checkpointPath)) {
      try {
        const data = fs.readFileSync(this.checkpointPath, 'utf8');
        const parsed: Checkpoint = JSON.parse(data);
        
        if (parsed.inputFileHash === inputHash) {
          logger.info(`Resuming from checkpoint at index ${parsed.lastProcessedIndex}`);
          this.currentCheckpoint = parsed;
          return this.currentCheckpoint;
        } else {
          logger.warn(`Input file hash mismatch. Starting fresh despite existing checkpoint.`);
        }
      } catch (err: any) {
        logger.error(`Failed to read checkpoint: ${err.message}. Starting fresh.`);
      }
    } else if (ignoreCheckpoint) {
      logger.info(`Ignoring checkpoint. Starting fresh.`);
    }

    this.currentCheckpoint = this.createDefaultCheckpoint(inputHash);
    this.flush();
    return this.currentCheckpoint;
  }

  public update(index: number, stats: { total: number; success: number; failed: number }): void {
    this.currentCheckpoint.lastProcessedIndex = index;
    this.currentCheckpoint.stats = stats;
    this.currentCheckpoint.lastUpdatedAt = new Date().toISOString();
  }

  public getCheckpoint(): Checkpoint {
    return this.currentCheckpoint;
  }

  public flush(): void {
    try {
      const tempPath = `${this.checkpointPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.currentCheckpoint, null, 2), 'utf8');
      fs.renameSync(tempPath, this.checkpointPath);
      logger.debug(`Checkpoint flushed at index ${this.currentCheckpoint.lastProcessedIndex}`);
    } catch (err: any) {
      logger.error(`Failed to flush checkpoint: ${err.message}`);
    }
  }

  private createDefaultCheckpoint(inputHash: string): Checkpoint {
    const now = new Date().toISOString();
    return {
      lastProcessedIndex: -1, // -1 means nothing processed yet
      inputFileHash: inputHash,
      startedAt: now,
      lastUpdatedAt: now,
      stats: { total: 0, success: 0, failed: 0 }
    };
  }

  private hashFile(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    
    // Read the first 100KB or so to generate a hash quickly (instead of hashing GBs of csv)
    // Or stat the file for size + mtime. For simplicity we hash file stats.
    const stats = fs.statSync(filePath);
    return crypto.createHash('sha256')
      .update(`${stats.size}-${stats.mtimeMs}`)
      .digest('hex');
  }
}
