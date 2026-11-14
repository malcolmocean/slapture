// tests/unit/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../../src/parser/index.js';

describe('Parser', () => {
  const parser = new Parser();

  describe('full input preserved as payload', () => {
    it('should preserve colon-prefixed input as full payload', () => {
      const result = parser.parse('dump: this is a test');

      expect(result.payload).toBe('dump: this is a test');
    });

    it('should preserve input with multiple colons', () => {
      const result = parser.parse('note: remember: buy milk');

      expect(result.payload).toBe('note: remember: buy milk');
    });

    it('should preserve multi-word colon-prefixed input', () => {
      const result = parser.parse('gwen memory: you said milk!');

      expect(result.payload).toBe('gwen memory: you said milk!');
    });

    it('should preserve hashtag-prefixed input', () => {
      const result = parser.parse('#tweet hello world');

      expect(result.payload).toBe('#tweet hello world');
    });
  });

  describe('parenthetical metadata', () => {
    it('should extract source from "(from Bob)"', () => {
      const result = parser.parse('movie reco Terminator 2 (from Bob)');

      expect(result.payload).toBe('movie reco Terminator 2');
      expect(result.metadata.source).toBe('Bob');
    });

    it('should handle multiple parentheticals', () => {
      const result = parser.parse('task do thing (urgent) (from Alice)');

      expect(result.payload).toBe('task do thing');
      expect(result.metadata.source).toBe('Alice');
      expect(result.metadata.tags).toContain('urgent');
    });
  });

  describe('implicit structure', () => {
    it('should detect measurement pattern', () => {
      const result = parser.parse('weight 88.2kg');

      expect(result.payload).toBe('weight 88.2kg');
      expect(result.metadata.detectedType).toBe('measurement');
    });
  });

  describe('no structure', () => {
    it('should pass through unstructured text', () => {
      const result = parser.parse('just some random text');

      expect(result.payload).toBe('just some random text');
      expect(Object.keys(result.metadata)).toHaveLength(0);
    });
  });
});
