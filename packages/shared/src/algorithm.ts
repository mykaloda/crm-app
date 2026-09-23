import { z } from 'zod';

export const algorithmWeightsSchema = z
  .object({
    goalsValues: z.number().min(0).max(100),
    lifestyle: z.number().min(0).max(100),
    personality: z.number().min(0).max(100),
    interests: z.number().min(0).max(100),
    activity: z.number().min(0).max(100),
  })
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) > 0, 'At least one weight must be positive');

export type AlgorithmWeights = z.infer<typeof algorithmWeightsSchema>;

export const DEFAULT_WEIGHTS: AlgorithmWeights = {
  goalsValues: 35,
  lifestyle: 25,
  personality: 20,
  interests: 15,
  activity: 5,
};

export const algorithmConfigSchema = z.object({
  weights: algorithmWeightsSchema,
  vectorTopK: z.number().int().min(10).max(1000).default(200),
  negotiationTopN: z.number().int().min(1).max(100).default(20),
  minScore: z.number().min(0).max(100).default(50),
  dailyMatchesFree: z.number().int().min(1).max(10).default(3),
  dailyMatchesPremium: z.number().int().min(1).max(10).default(5),
});
export type AlgorithmConfig = z.infer<typeof algorithmConfigSchema>;

export const DEFAULT_ALGORITHM_CONFIG: AlgorithmConfig = {
  weights: DEFAULT_WEIGHTS,
  vectorTopK: 200,
  negotiationTopN: 20,
  minScore: 50,
  dailyMatchesFree: 3,
  dailyMatchesPremium: 5,
};

export interface ScoreBreakdown {
  goalsValues: number;
  lifestyle: number;
  personality: number;
  interests: number;
  activity: number;
  total: number;
}
