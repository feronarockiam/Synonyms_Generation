import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SearchableTerm, GroqResponseType, GroqResponseSchema } from '../types';
import fs from 'fs';

export class ClaudeClient {
  private client: Anthropic;
  private promptTemplate: string;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.claude.apiKey,
    });
    this.promptTemplate = fs.readFileSync(config.paths.prompt, 'utf8');
  }

  /**
   * Enriches a batch of terms using Claude.
   */
  public async enrichTerms(batch: SearchableTerm[]): Promise<GroqResponseType> {
    const batchJson = JSON.stringify(batch.map(t => ({ concept: t.canonical })), null, 2);
    const fullPrompt = this.promptTemplate.replace('[INSERT_BATCH_HERE]', batchJson);

    try {
      logger.info(`[Claude: ${config.claude.model}] Processing batch of ${batch.length} terms.`);
      
      const response = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: config.claude.maxTokens,
        system: "You are an expert in Indian ecommerce search behavior. Return ONLY raw JSON without any markdown formatting or explanation.",
        messages: [
          { role: 'user', content: fullPrompt }
        ],
      });

      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      if (!content) throw new Error("Empty response from Claude");

      // Robust JSON extraction (Claude sometimes wraps in markdown even if told not to)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;

      const rawJson = JSON.parse(jsonStr);
      const validated = GroqResponseSchema.parse(rawJson);
      
      return validated;
    } catch (err: any) {
      logger.error(`Claude API Error: ${err.message}`);
      throw err;
    }
  }
}

export const globalClaudeClient = new ClaudeClient();
