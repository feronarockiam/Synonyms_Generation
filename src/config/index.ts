import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Robust .env loading
try {
  const envPath = path.resolve(process.cwd(), '../.env');
  console.log('DEBUG: Looking for .env at', envPath);
  if (fs.existsSync(envPath)) {
    console.log('DEBUG: .env exists at', envPath);
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line: string) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        console.log(`DEBUG: Found key [${key}] with length ${value.length}. Value start: ${value.substring(0, 5)}`);
        process.env[key] = value;
      }
    });
  } else {
    console.log('DEBUG: .env NOT FOUND at', envPath);
  }
} catch (e: any) {
  console.log('DEBUG: Error reading .env', e.message);
}
dotenv.config(); // fallback

export const config = {
  algolia: {
    appId: process.env.ALGOLIA_APP_ID || '',
    apiKey: process.env.ALGOLIA_API_KEY || '',
    indexName: process.env.ALGOLIA_INDEX_NAME || 'products',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    models: [
      'qwen/qwen3-32b',
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct'
    ],
    rpmLimit: 30, // Requests per minute
    tpmLimit: 30000, // Tokens per minute
    timeoutMs: 30000,
    maxRetries: 3,
  },
  claude: {
    apiKey: process.env.CLAUDE_API_KEY || '',
    model: 'claude-haiku-4-5',
    maxTokens: 4096,
    timeoutMs: 40000,
  },
  pipeline: {
    provider: 'claude',
    batchSize: 15,
    maxTokensPerBatch: 3000,
    checkpointInterval: 10,
    concurrency: 1, // Claude is usually stricter on concurrency for new accounts
    exclusionPatterns: [
      /misc/i, /sku/i, /temp/i, /hold/i, /test/i, /unknown/i, /do not use/i
    ],
  },
  paths: {
    baseDir: path.resolve(__dirname, '../../'),
    input: path.resolve(__dirname, '../../data/input'),
    output: path.resolve(__dirname, '../../data/output/synonyms.jsonl'),
    cache: path.resolve(__dirname, '../../data/cache/term_cache.json'),
    checkpoint: path.resolve(__dirname, '../../data/checkpoints/progress.json'),
    failedQueue: path.resolve(__dirname, '../../data/failed/dead_letter_queue.json'),
    lockFile: path.resolve(__dirname, '../../data/.pipeline.lock'),
    prompt: path.resolve(__dirname, '../../prompts/groq_synonym_prompt.txt'),
  }
};
