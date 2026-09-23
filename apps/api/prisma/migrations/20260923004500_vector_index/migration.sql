-- pgvector ANN index on the AI description embedding (cosine distance)
CREATE INDEX "Profile_embedding_hnsw_idx" ON "Profile" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "Match_status_idx" ON "Match" ("status");
