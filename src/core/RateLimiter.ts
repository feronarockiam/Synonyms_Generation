import { config } from '../config';
import { logger } from '../utils/logger';

export class RateLimiter {
  private availableRequests: number;
  private availableTokens: number;
  private lastRefillTime: number;

  private requestRefillRate: number; // requests per ms
  private tokenRefillRate: number; // tokens per ms

  constructor() {
    this.availableRequests = config.groq.rpmLimit;
    this.availableTokens = config.groq.tpmLimit;
    this.lastRefillTime = Date.now();
    
    this.requestRefillRate = config.groq.rpmLimit / 60000;
    this.tokenRefillRate = config.groq.tpmLimit / 60000;
  }

  private refill() {
    const now = Date.now();
    const elapsedTime = now - this.lastRefillTime;
    
    this.availableRequests = Math.min(
      config.groq.rpmLimit,
      this.availableRequests + elapsedTime * this.requestRefillRate
    );
    
    this.availableTokens = Math.min(
      config.groq.tpmLimit,
      this.availableTokens + elapsedTime * this.tokenRefillRate
    );
    
    this.lastRefillTime = now;
  }

  public async acquire(tokensNeeded: number): Promise<void> {
    this.refill();

    while (this.availableRequests < 1 || this.availableTokens < tokensNeeded) {
      // Calculate sleep time needed
      const sleepForRequests = this.availableRequests < 1 
        ? (1 - this.availableRequests) / this.requestRefillRate 
        : 0;
        
      const sleepForTokens = this.availableTokens < tokensNeeded
        ? (tokensNeeded - this.availableTokens) / this.tokenRefillRate
        : 0;
        
      const sleepTimeMs = Math.ceil(Math.max(sleepForRequests, sleepForTokens, 100)); // Sleep at least 100ms
      
      logger.debug(`Rate limit reached. Sleeping for ${sleepTimeMs}ms to acquire ${tokensNeeded} tokens`);
      await new Promise(resolve => setTimeout(resolve, sleepTimeMs));
      
      this.refill();
    }

    this.availableRequests -= 1;
    this.availableTokens -= tokensNeeded;
  }
}

export const globalRateLimiter = new RateLimiter();
