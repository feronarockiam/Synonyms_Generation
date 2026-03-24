import { getEncoding } from 'js-tiktoken';
import { SearchableTerm } from '../types';

export class TokenEstimator {
  private static encoding = getEncoding('cl100k_base'); // approximate enough for llama tokens

  public static estimateString(text: string): number {
    return this.encoding.encode(text).length;
  }

  public static estimateBatch(terms: SearchableTerm[]): number {
    const promptOverhead = 800;
    const outputEstimation = 500;
    
    const termsStr = terms.map(t => JSON.stringify(t)).join('\\n');
    const inputTokens = this.estimateString(termsStr);
    
    return promptOverhead + inputTokens + outputEstimation;
  }
  
  public static estimatePromptAndOutput(termsCount: number): number {
    // Basic approximation: 800 overhead + 10 per term + 500 output
    return 800 + (termsCount * 10) + 500;
  }
}
