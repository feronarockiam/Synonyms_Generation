import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';

export class Writer {
  private outputPath: string;

  constructor(outputPath: string = config.paths.output) {
    this.outputPath = outputPath;
  }

  /**
   * Appends a JSON line. Safe from corruption.
   */
  public append(result: any): void {
    try {
      const line = JSON.stringify(result) + '\\n';
      fs.appendFileSync(this.outputPath, line, 'utf8');
    } catch (err: any) {
      logger.error(`Failed to write to output: ${err.message}`);
    }
  }

  /**
   * Appends multiple JSON lines.
   */
  public appendBatch(results: any[]): void {
    if (results.length === 0) return;
    try {
      const data = results.map(r => JSON.stringify(r)).join('\\n') + '\\n';
      fs.appendFileSync(this.outputPath, data, 'utf8');
    } catch (err: any) {
      logger.error(`Failed to write batch to output: ${err.message}`);
    }
  }
}

// Removed globalWriter singleton to allow dynamic configuration
