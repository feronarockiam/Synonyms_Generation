import { z } from 'zod';

// Base Interfaces
export interface SearchableTerm {
  canonical: string;
  type: 'P-Type' | 'Category' | 'Sub-category' | 'Sub-sub-category';
  normalized: string;
  hash: string;
}

export interface SynonymEntry {
  term: string;
  type: 'hinglish' | 'hindi_native' | 'tamil' | 'telugu' | 'bengali' | 'marathi' | 'gujarati' | 'malayalam' | 'kannada' | 'english_variant' | 'misspelling' | 'phonetic' | 'modern_slang' | 'regional_generic';
  lang: 'en' | 'hi' | 'ta' | 'te' | 'bn' | 'mr' | 'gu' | 'ml' | 'kn';
  confidence: number;
}

export interface CacheEntry {
  hash: string;
  canonical: string; // The input concept
  type: string;
  searchable: boolean;
  exact_synonyms: SynonymEntry[];
  query_expansions: SynonymEntry[];
  negative_terms: string[];
  processedAt: string;
  requestId: string;
}

export interface CheckpointStats {
  total: number;
  success: number;
  failed: number;
}

export interface Checkpoint {
  lastProcessedIndex: number;
  inputFileHash: string;
  startedAt: string;
  lastUpdatedAt: string;
  stats: CheckpointStats;
}

export interface FailedQueueEntry {
  term: string;
  error: string;
  attempts: number;
  lastAttemptAt: string;
}

// Zod schemas for validation
export const SynonymEntrySchema = z.object({
  term: z.string(),
  type: z.enum(['hinglish', 'hindi_native', 'tamil', 'telugu', 'bengali', 'marathi', 'gujarati', 'malayalam', 'kannada', 'english_variant', 'misspelling', 'phonetic', 'modern_slang', 'regional_generic']),
  lang: z.enum(['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'ml', 'kn']),
  confidence: z.number().min(0).max(1)
});

export const GroqTermResponseSchema = z.object({
  concept: z.string(),
  searchable: z.boolean(),
  exact_synonyms: z.array(SynonymEntrySchema),
  query_expansions: z.array(SynonymEntrySchema).optional().default([]),
  negative_terms: z.array(z.string()).optional().default([])
});

export const GroqResponseSchema = z.object({
  results: z.array(GroqTermResponseSchema)
});

export type GroqResponseType = z.infer<typeof GroqResponseSchema>;
