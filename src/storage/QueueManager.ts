import fs from 'fs';
import { FailedQueueEntry } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class QueueManager {
  private queuePath: string;
  private queue: FailedQueueEntry[] = [];

  constructor(queuePath: string = config.paths.failedQueue) {
    this.queuePath = queuePath;
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.queuePath)) {
      try {
        const data = fs.readFileSync(this.queuePath, 'utf8');
        this.queue = JSON.parse(data);
        logger.info(`Loaded ${this.queue.length} items from dead letter queue.`);
      } catch (err: any) {
        logger.error(`Failed to load queue: ${err.message}`);
        this.queue = [];
      }
    }
  }

  public add(entry: FailedQueueEntry): void {
    const existing = this.queue.findIndex(q => q.term === entry.term);
    if (existing >= 0) {
      this.queue[existing] = entry; // update with latest attempts
    } else {
      this.queue.push(entry);
    }
    this.flush();
  }

  public getAll(): FailedQueueEntry[] {
    return this.queue;
  }

  public remove(term: string): void {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(q => q.term !== term);
    if (this.queue.length < initialLength) {
      this.flush();
    }
  }

  private flush(): void {
    try {
      const tempPath = `${this.queuePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.queue, null, 2), 'utf8');
      fs.renameSync(tempPath, this.queuePath);
    } catch (err: any) {
      logger.error(`Failed to flush queue: ${err.message}`);
    }
  }
}
