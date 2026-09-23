import OpenAI from 'openai';

export const EMBEDDING_DIM = 1536;

/** Swap providers by implementing this interface; vectors must be EMBEDDING_DIM long. */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }
  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: this.model, input: texts, dimensions: EMBEDDING_DIM });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

const STOPWORDS = new Set(
  'the a an and or but of to in on at for with is are was were be been being he she they them his her their its it this that these those who whom as by from about into over after before very really just also has have had not no yes will would can could loves love likes like enjoys enjoy'.split(
    ' ',
  ),
);

function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic offline embedding: signed feature hashing of word unigrams, bigrams
 * and 4-char prefixes, L2-normalised. Similar texts get similar vectors, which is
 * enough for local development, tests and the seed data.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  embedOne(text: string): number[] {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      const sign = fnv1a(feature, 0x12345678) & 1 ? 1 : -1;
      v[h % EMBEDDING_DIM] += sign * weight;
    };
    words.forEach((w, i) => {
      add(`u:${w}`, 1);
      if (w.length > 4) add(`p:${w.slice(0, 4)}`, 0.5);
      if (i > 0) add(`b:${words[i - 1]}_${w}`, 0.7);
    });
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm > 0 ? v.map((x) => x / norm) : v;
  }
}
