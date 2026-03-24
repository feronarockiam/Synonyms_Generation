import Groq from 'groq-sdk';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { globalRateLimiter } from '../core/RateLimiter';
import { TokenEstimator } from '../core/TokenEstimator';
import { GroqResponseSchema, GroqResponseType, SearchableTerm } from '../types';

export class GroqClient {
  private groq: Groq;
  private promptTemplate: string = '';
  private breakerFailures: number = 0;
  private breakerTripTime: number = 0;

  constructor() {
    this.groq = new Groq({ 
      apiKey: config.groq.apiKey,
      timeout: config.groq.timeoutMs 
    });
    this.loadPrompt();
  }

  private loadPrompt() {
    if (fs.existsSync(config.paths.prompt)) {
      this.promptTemplate = fs.readFileSync(config.paths.prompt, 'utf8');
    } else {
      logger.warn('Prompt file not found. Using fallback prompt.');
      this.promptTemplate = `You are a taxonomy synonym expert. Respond ONLY with valid JSON.
PROCESS THESE TERMS: [INSERT_BATCH_HERE]`;
    }
  }

  /**
   * Enrich a batch of terms with synonyms.
   * Handles Rate limits, retries, exponential backoff, circuit breaking, and MODEL FALLBACK.
   */
  public async enrichTerms(batch: SearchableTerm[]): Promise<GroqResponseType | null> {
    if (this.isCircuitBreakerTripped()) {
      throw new Error("Circuit breaker is open. Aborting request.");
    }

    const estimatedTokens = TokenEstimator.estimateBatch(batch);
    const termsJson = JSON.stringify(batch.map(t => ({ canonical: t.canonical, type: t.type })), null, 2);
    const prompt = this.promptTemplate.replace('[INSERT_BATCH_HERE]', `Terms to process: ${termsJson}\n\nIMPORTANT: Respond with a single JSON object containing a "results" array.`);

    let attempts = 0;
    let currentModelIndex = 0;

    while (attempts < config.groq.maxRetries * config.groq.models.length) {
      const model = config.groq.models[currentModelIndex];
      try {
        attempts++;
        await globalRateLimiter.acquire(estimatedTokens);

        logger.info(`[Model: ${model}] Attempt ${attempts} for ${batch.length} terms`);
        
        const completion = await this.groq.chat.completions.create({
          messages: [
            { role: 'system', content: prompt }
          ],
          model: model,
          response_format: { type: "json_object" },
          temperature: 0.1
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) throw new Error("Empty response from Groq");

        const rawJson = JSON.parse(content);
        const parsed = GroqResponseSchema.parse(rawJson);
        
        this.breakerFailures = 0;
        return parsed;

      } catch (error: any) {
        // Track 5xx for Circuit Breaker
        if (error?.status >= 500 && error?.status < 600) {
          this.breakerFailures++;
          if (this.breakerFailures >= 5) this.tripCircuitBreaker();
        }

        // Handle specific Groq errors
        if (error?.status === 429 || error?.status === 413 || (error?.status >= 500 && error?.status < 600)) {
           logger.warn(`API Error ${error?.status} with ${model}.`);
           
           // If it's a transient failure or rate limit, we might want to try other models in hierarchy
           if (currentModelIndex < config.groq.models.length - 1) {
              currentModelIndex++;
              logger.info(`Fallback triggered: Switching to ${config.groq.models[currentModelIndex]}`);
           }
        } else {
           logger.error(`Non-recoverable API Error: ${error.message}`);
           throw error; // Rethrow to escalate to Token limit handling in Processor if 413
        }

        if (attempts >= config.groq.maxRetries * config.groq.models.length) {
          logger.error(`Max exhaustion reached across all models for batch.`);
          throw error;
        }

        const backoffMs = Math.pow(2, attempts % config.groq.maxRetries || 1) * 1000 + Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
    return null;
  }

  private isCircuitBreakerTripped(): boolean {
    if (this.breakerFailures >= 5) {
      const now = Date.now();
      if (now - this.breakerTripTime < 300000) return true;
      this.breakerFailures = 4;
    }
    return false;
  }

  private tripCircuitBreaker() {
    this.breakerTripTime = Date.now();
    logger.error("CIRCUIT BREAKER TRIPPED! Pausing for 5 minutes.");
  }
}

export const globalGroqClient = new GroqClient();
