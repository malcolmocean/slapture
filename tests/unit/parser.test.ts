// tests/unit/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../../src/parser/index.js';

describe('Parser', () => {
  const parser = new Parser();

  describe('prefix with colon', () => {
    it('should extract explicit route from "dump: content"', () => {
      const result = parser.parse('dump: this is a test');

      expect(result.explicitRoute).toBe('dump');
      expect(result.payload).toBe('this is a test');
    });

    it('should handle colons in payload', () => {
      const result = parser.parse('note: remember: buy milk');

      expect(result.explicitRoute).toBe('note');
      expect(result.payload).toBe('remember: buy milk');
    });

    it('should handle multi-word route hints', () => {
      const result = parser.parse('gwen memory: you said milk!');

      expect(result.explicitRoute).toBe('gwen memory');
      expect(result.payload).toBe('you said milk!');
    });

    it('should normalize multi-word route hints (lowercase, trim)', () => {
      const result = parser.parse('Baby  Milestones: first steps today');

      expect(result.explicitRoute).toBe('baby milestones');
      expect(result.payload).toBe('first steps today');
    });
  });

  describe('hashtag prefix', () => {
    it('should extract route from "#tweet content"', () => {
      const result = parser.parse('#tweet hello world');

      expect(result.explicitRoute).toBe('tweet');
      expect(result.payload).toBe('hello world');
    });
  });

  describe('parenthetical metadata', () => {
    it('should extract source from "(from Bob)"', () => {
      const result = parser.parse('movie reco Terminator 2 (from Bob)');

      expect(result.explicitRoute).toBeNull();
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

      expect(result.explicitRoute).toBeNull();
      expect(result.payload).toBe('weight 88.2kg');
      expect(result.metadata.detectedType).toBe('measurement');
    });
  });

  describe('no structure', () => {
    it('should pass through unstructured text', () => {
      const result = parser.parse('just some random text');

      expect(result.explicitRoute).toBeNull();
      expect(result.payload).toBe('just some random text');
      expect(Object.keys(result.metadata)).toHaveLength(0);
    });
  });
});
