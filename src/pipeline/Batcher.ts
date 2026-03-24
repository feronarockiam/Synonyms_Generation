import { SearchableTerm } from '../types';
import { TokenEstimator } from '../core/TokenEstimator';
import { config } from '../config';

export class Batcher {
  private batch: SearchableTerm[] = [];

  public add(term: SearchableTerm): { isFull: boolean; batch: SearchableTerm[] | null } {
    this.batch.push(term);

    const tokenEstimate = TokenEstimator.estimateBatch(this.batch);
    const isFull = this.batch.length >= config.pipeline.batchSize || tokenEstimate >= config.pipeline.maxTokensPerBatch;

    if (isFull) {
      const flushBatch = [...this.batch];
      this.batch = [];
      return { isFull: true, batch: flushBatch };
    }

    return { isFull: false, batch: null };
  }

  public flush(): SearchableTerm[] {
    const flushBatch = [...this.batch];
    this.batch = [];
    return flushBatch;
  }
}
