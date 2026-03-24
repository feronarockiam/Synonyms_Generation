import crypto from 'crypto';

export class Hasher {
  /**
   * Normalizes the term: lowercase, trim, remove extra spaces.
   */
  public static normalize(term: string): string {
    return term
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' '); // Replace multiple spaces with a single space
  }

  /**
   * Generates SHA256 hash of the normalized term.
   */
  public static hash(term: string): string {
    const normalized = Hasher.normalize(term);
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}
