import fs from 'fs';
import csv from 'csv-parser';
import { algoliasearch } from 'algoliasearch';
import { SearchableTerm } from '../types';
import { config } from '../config';
import { Hasher } from '../core/Hasher';
import { logger } from '../utils/logger';

export class Extractor {
  private validTypes = new Set(['P-Type', 'Category', 'Sub-category', 'Sub-sub-category', 'PType', 'SubCategory', 'SubSubCategory']);
  private seenTerms = new Set<string>();

  /**
   * Generator that yields unique SearchableTerms.
   * If filePath ends with .csv, it reads from the CSV file.
   * Otherwise, it fetches from Algolia.
   */
  public async *streamCSV(filePath?: string): AsyncGenerator<{ index: number, term: SearchableTerm | null }> {
    if (filePath && filePath.endsWith('.csv')) {
      yield* this.readFromCsv(filePath);
    } else {
      yield* this.readFromAlgolia();
    }
  }

  private async *readFromCsv(filePath: string): AsyncGenerator<{ index: number, term: SearchableTerm | null }> {
    logger.info(`Extracting terms from CSV file: ${filePath}`);
    let rowIndex = 0;

    const results: any[] = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(true))
        .on('error', (err) => reject(err));
    });

    for (const row of results) {
      rowIndex++;
      // Check for Keyword column
      const term = row['Keyword'] || row['keyword'] || row['term'] || row['Term'];
      if (!term || typeof term !== 'string' || term.trim() === '') continue;

      const searchableTerm = this.processTerm(term, 'Keyword');
      if (searchableTerm) {
        yield { index: rowIndex, term: searchableTerm };
      }
    }
  }

  private async *readFromAlgolia(): AsyncGenerator<{ index: number, term: SearchableTerm | null }> {
    const client = algoliasearch(config.algolia.appId, config.algolia.apiKey);
    let page = 0;
    let nbPages = 1;
    let rowIndex = 0;

    logger.info(`Extracting taxonomy terms from Algolia index: ${config.algolia.indexName}`);

    while (page < nbPages) {
      try {
        const result = await client.searchSingleIndex({
          indexName: config.algolia.indexName,
          searchParams: {
            query: '',
            page: page,
            hitsPerPage: 1000,
            attributesToRetrieve: ['product_type', 'category_name', 'subcategory_name', 'subsubcategory_name']
          }
        });

        nbPages = result.nbPages || 1;

        for (const hit of result.hits) {
          rowIndex++;
          const h = hit as any;

          const fields = [
            { term: h.product_type, type: 'P-Type' },
            { term: h.category_name, type: 'Category' },
            { term: h.subcategory_name, type: 'Sub-category' },
            { term: h.subsubcategory_name, type: 'Sub-sub-category' }
          ];

          for (const { term, type } of fields) {
            if (!term || typeof term !== 'string' || term.trim() === '') continue;

            const searchableTerm = this.processTerm(term, type);
            if (searchableTerm) {
              yield { index: rowIndex, term: searchableTerm };
              
              // Remove the limit of 4 terms to allow processing all
              // if (this.seenTerms.size >= 4) {
              //   logger.info('Reached limit of 4 terms for quality testing. Halting extraction.');
              //   return;
              // }
            }
          }
        }
        page++;
      } catch (e: any) {
        logger.error(`Failed connecting to Algolia: ${e.message}`);
        break;
      }
    }
  }

  private processTerm(term: string, type: string): SearchableTerm | null {
    const canonical = term.trim();
    const normalized = Hasher.normalize(canonical);
    const hash = Hasher.hash(normalized);

    if (this.seenTerms.has(hash)) {
      return null;
    }
    this.seenTerms.add(hash);

    if (!this.isSearchable(canonical)) {
      return null;
    }

    return {
      canonical,
      type: type as any,
      normalized,
      hash
    };
  }

  private isSearchable(term: string): boolean {
    for (const pattern of config.pipeline.exclusionPatterns) {
      if (pattern.test(term)) {
        return false;
      }
    }
    return true;
  }
}
