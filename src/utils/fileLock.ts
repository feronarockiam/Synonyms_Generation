import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export class FileLock {
  private lockPath: string;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  public acquire(): void {
    if (fs.existsSync(this.lockPath)) {
      const lockData = fs.readFileSync(this.lockPath, 'utf8');
      const pid = parseInt(lockData.trim(), 10);
      
      if (!isNaN(pid) && this.isProcessRunning(pid)) {
        logger.error(`Pipeline already running with PID ${pid}.`);
        process.exit(1);
      } else {
        logger.warn(`Found stale lock file for PID ${pid}. Overwriting.`);
      }
    }

    fs.writeFileSync(this.lockPath, process.pid.toString());
    
    // Auto cleanup on exit
    process.on('exit', () => this.release());
    process.on('SIGINT', () => { this.release(); process.exit(0); });
    process.on('SIGTERM', () => { this.release(); process.exit(0); });
  }

  public release(): void {
    if (fs.existsSync(this.lockPath)) {
      const lockData = fs.readFileSync(this.lockPath, 'utf8');
      if (parseInt(lockData.trim(), 10) === process.pid) {
        fs.unlinkSync(this.lockPath);
      }
    }
  }

  private isProcessRunning(pid: number): boolean {
    if (pid === process.pid) return true;
    try {
      return process.kill(pid, 0); // Throws an error to check if process exists
    } catch (e) {
      return false;
    }
  }
}
