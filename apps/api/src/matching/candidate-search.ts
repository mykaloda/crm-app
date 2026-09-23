import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { incompatibleRelationshipPairs } from './filters';

export interface RawCandidate {
  userId: string;
  distanceKm: number;
  cosine: number | null;
}

const BAD_REL = Prisma.join(incompatibleRelationshipPairs().map(([a, b]) => Prisma.sql`(${a}, ${b})`));

/**
 * Step 1 + 2 of the pipeline: hard filters evaluated in SQL in both directions,
 * then nearest neighbours by cosine distance on the description embedding.
 * Mirrors `hardFilterReason` in filters.ts (kept in sync by the e2e test).
 *
 * Filters run first, so the cosine ordering is exact over the filtered set. That is
 * accurate and fast enough up to ~100k active profiles; beyond that, move to an
 * index-first HNSW scan with iterative scans (pgvector >= 0.8) plus post-filtering.
 */
export async function searchCandidates(prisma: PrismaService, userId: string, topK: number): Promise<RawCandidate[]> {
  return prisma.$queryRaw<RawCandidate[]>`
      WITH me AS (
        SELECT p.*, date_part('year', age(p."birthDate"))::int AS age
        FROM "Profile" p WHERE p."userId" = ${userId}
      ),
      cand AS (
        SELECT c."userId", c.embedding,
          date_part('year', age(c."birthDate"))::int AS age,
          6371 * 2 * asin(sqrt(
            power(sin(radians(c.lat - me.lat) / 2), 2) +
            cos(radians(me.lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - me.lng) / 2), 2)
          )) AS dist,
          c.gender, c.seeking, c."ageMin", c."ageMax", c."radiusKm", c."relationshipType", c."wantsChildren",
          c.timeline, c.smoking, c.alcohol, c.pets, c."hasChildren", c."dealBreakers"
        FROM "Profile" c
        JOIN "User" u ON u.id = c."userId", me
        WHERE c."userId" <> me."userId"
          AND c.status = 'ACTIVE'
          AND u.status = 'ACTIVE' AND u."aiEnabled" = true AND u."ageVerificationStatus" = 'VERIFIED'
      )
      SELECT cand."userId",
             cand.dist::float8 AS "distanceKm",
             CASE WHEN me.embedding IS NULL OR cand.embedding IS NULL THEN NULL
                  ELSE (1 - (cand.embedding <=> me.embedding))::float8 END AS cosine
      FROM cand, me
      WHERE cand.gender = ANY(me.seeking) AND me.gender = ANY(cand.seeking)
        AND cand.age BETWEEN me."ageMin" AND me."ageMax"
        AND me.age BETWEEN cand."ageMin" AND cand."ageMax"
        AND cand.dist <= LEAST(me."radiusKm", cand."radiusKm")
        AND (me."relationshipType", cand."relationshipType") NOT IN (${BAD_REL})
        AND NOT ((me."wantsChildren" = 'yes' AND cand."wantsChildren" = 'no') OR (me."wantsChildren" = 'no' AND cand."wantsChildren" = 'yes'))
        AND NOT ((me.timeline = 'asap' AND cand.timeline = 'no_rush') OR (me.timeline = 'no_rush' AND cand.timeline = 'asap'))
        -- deal-breakers, both directions
        AND NOT COALESCE(me."dealBreakers" -> 'excludeSmoking' ? cand.smoking, false)
        AND NOT COALESCE(me."dealBreakers" -> 'excludeAlcohol' ? cand.alcohol, false)
        AND NOT COALESCE(me."dealBreakers" -> 'excludePets' ? cand.pets, false)
        AND NOT (COALESCE((me."dealBreakers" ->> 'noPartnerChildren')::boolean, false) AND COALESCE(cand."hasChildren", false))
        AND NOT COALESCE(cand."dealBreakers" -> 'excludeSmoking' ? me.smoking, false)
        AND NOT COALESCE(cand."dealBreakers" -> 'excludeAlcohol' ? me.alcohol, false)
        AND NOT COALESCE(cand."dealBreakers" -> 'excludePets' ? me.pets, false)
        AND NOT (COALESCE((cand."dealBreakers" ->> 'noPartnerChildren')::boolean, false) AND COALESCE(me."hasChildren", false))
        -- blocks and closed pairs
        AND NOT EXISTS (
          SELECT 1 FROM "Block" b
          WHERE (b."blockerId" = me."userId" AND b."blockedId" = cand."userId")
             OR (b."blockerId" = cand."userId" AND b."blockedId" = me."userId"))
        AND NOT EXISTS (
          SELECT 1 FROM "Match" m
          WHERE m."userAId" = LEAST(me."userId" COLLATE "C", cand."userId" COLLATE "C")
            AND m."userBId" = GREATEST(me."userId" COLLATE "C", cand."userId" COLLATE "C")
            AND m.status IN ('REJECTED', 'CLOSED'))
      ORDER BY cand.embedding <=> me.embedding NULLS LAST
      LIMIT ${topK}`;
}
