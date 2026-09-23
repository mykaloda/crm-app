import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeSource, Prisma } from '@prisma/client';
import {
  FIELD_DEFS,
  ProfileData,
  VisibilityMap,
  ageFromBirthDate,
  checkProfileText,
  mergeProfile,
  missingRequired,
  normalizeVisibilityMap,
  profileCompleteness,
  profileDataSchema,
  profilePatchSchema,
} from '@agentmatch/shared';
import { ConsentService } from '../common/consent.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { profileDataToColumns, rowToProfileData, rowVisibility } from './profile.mapper';

const SENSITIVE_KEYS = FIELD_DEFS.filter((f) => f.sensitive).map((f) => f.key);

export interface DraftView {
  id: string;
  source: ChangeSource;
  note: string | null;
  patch: ProfileData;
  createdAt: Date;
}

export class ProfileValidationError extends BadRequestException {
  constructor(message: string, details?: unknown) {
    super({ error: 'profile_invalid', message, details });
  }
}

function stripSensitive(patch: ProfileData): { patch: ProfileData; stripped: string[] } {
  if (!patch.values) return { patch, stripped: [] };
  const values = { ...patch.values } as Record<string, unknown>;
  const stripped = SENSITIVE_KEYS.filter((k) => k in values);
  stripped.forEach((k) => delete values[k]);
  return { patch: { ...patch, values: values as ProfileData['values'] }, stripped };
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly consents: ConsentService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async load(userId: string) {
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    return {
      row,
      data: rowToProfileData(row, this.crypto),
      visibility: rowVisibility(row),
    };
  }

  async getView(userId: string) {
    const { row, data, visibility } = await this.load(userId);
    const drafts = await this.listDrafts(userId);
    const photos = await this.prisma.photo.findMany({ where: { userId }, orderBy: { position: 'asc' } });
    return {
      status: row?.status ?? 'INCOMPLETE',
      completeness: row?.completeness ?? 0,
      approvedAt: row?.approvedAt ?? null,
      data,
      visibility,
      missing: missingRequired(data),
      drafts,
      photos: photos.map((p) => ({ id: p.id, position: p.position, moderation: p.moderation })),
    };
  }

  async listDrafts(userId: string): Promise<DraftView[]> {
    const rows = await this.prisma.profileDraft.findMany({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((d) => ({
      id: d.id,
      source: d.source,
      note: d.note,
      patch: this.crypto.decryptJson<ProfileData>(d.patchEnc) ?? {},
      createdAt: d.createdAt,
    }));
  }

  /** Validate a patch against the current profile and safety rules. Returns the merged profile. */
  private async validate(userId: string, current: ProfileData, patch: ProfileData): Promise<ProfileData> {
    const parsed = profilePatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ProfileValidationError(
        'Invalid profile data',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const merged = mergeProfile(current, parsed.data);
    const b = merged.basic ?? {};
    if (b.birthDate && ageFromBirthDate(b.birthDate) < 18) throw new ProfileValidationError('Users must be 18 or older');
    if (b.ageMin && b.ageMax && b.ageMin > b.ageMax) throw new ProfileValidationError('ageMin must be <= ageMax');
    for (const [field, text] of [
      ['displayName', parsed.data.basic?.displayName],
      ['interestsText', parsed.data.interests?.interestsText],
      ['aiDescription', parsed.data.description?.aiDescription],
    ] as const) {
      if (!text) continue;
      const r = checkProfileText(text);
      if (r.blocked) throw new ProfileValidationError(`${field} must not contain ${r.categories.join(', ')}`);
    }
    const hasSensitive = SENSITIVE_KEYS.some((k) => parsed.data.values && k in parsed.data.values);
    if (hasSensitive && !(await this.consents.has(userId, 'SENSITIVE_DATA'))) {
      throw new ForbiddenException({
        error: 'sensitive_consent_required',
        message: 'Faith and politics require separate consent to processing of sensitive data',
      });
    }
    return profileDataSchema.parse(merged);
  }

  /** Apply a change the human made or approved. */
  async applyChanges(userId: string, patch: ProfileData, opts: { approved?: boolean } = {}) {
    const { row, data } = await this.load(userId);
    const merged = await this.validate(userId, data, patch);
    const completeness = profileCompleteness(merged);
    const ready = missingRequired(merged).length === 0;
    const status = row?.status === 'PAUSED' ? 'PAUSED' : ready ? 'ACTIVE' : 'INCOMPLETE';
    const columns = profileDataToColumns(merged, this.crypto);
    await this.prisma.profile.upsert({
      where: { userId },
      create: { ...(columns as Prisma.ProfileUncheckedCreateInput), userId, completeness, status, approvedAt: new Date() },
      update: { ...columns, completeness, status, approvedAt: opts.approved === false ? undefined : new Date() },
    });
    const textChanged = patch.description?.aiDescription !== undefined || patch.interests !== undefined;
    if (textChanged || !row) {
      await this.embeddings.updateProfileEmbedding(
        userId,
        EmbeddingsService.profileText({
          aiDescription: merged.description?.aiDescription,
          interestTags: merged.interests?.interestTags,
          interestsText: merged.interests?.interestsText,
        }),
      );
    }
    return this.getView(userId);
  }

  /**
   * Store an AI-proposed change as a draft for human review. Sensitive fields without
   * consent are dropped (and reported) instead of failing the whole draft.
   */
  async createDraft(
    userId: string,
    patch: ProfileData,
    source: ChangeSource,
    opts: { connectionId?: string; note?: string } = {},
  ) {
    let working = patch;
    let stripped: string[] = [];
    if (!(await this.consents.has(userId, 'SENSITIVE_DATA'))) ({ patch: working, stripped } = stripSensitive(patch));
    const { data } = await this.load(userId);
    await this.validate(userId, data, working);
    const draft = await this.prisma.profileDraft.create({
      data: {
        userId,
        source,
        connectionId: opts.connectionId,
        note: opts.note?.slice(0, 500),
        patchEnc: this.crypto.encryptJson(working),
      },
    });
    return { draftId: draft.id, status: 'PENDING_HUMAN_APPROVAL' as const, droppedFields: stripped };
  }

  async approveDraft(userId: string, draftId: string, override?: ProfileData) {
    const draft = await this.prisma.profileDraft.findFirst({ where: { id: draftId, userId, status: 'PENDING' } });
    if (!draft) throw new NotFoundException('Draft not found');
    const patch = override ?? this.crypto.decryptJson<ProfileData>(draft.patchEnc) ?? {};
    const view = await this.applyChanges(userId, patch);
    await this.prisma.profileDraft.update({ where: { id: draftId }, data: { status: 'APPROVED', reviewedAt: new Date() } });
    return view;
  }

  async rejectDraft(userId: string, draftId: string) {
    const r = await this.prisma.profileDraft.updateMany({
      where: { id: draftId, userId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Draft not found');
    return { ok: true };
  }

  async setVisibility(userId: string, input: Partial<VisibilityMap>) {
    const { row, visibility } = await this.load(userId);
    const next = normalizeVisibilityMap({ ...visibility, ...input });
    if (!row) {
      await this.prisma.profile.create({ data: { userId, visibility: next } });
    } else {
      await this.prisma.profile.update({ where: { userId }, data: { visibility: next } });
    }
    return next;
  }

  async setPaused(userId: string, paused: boolean) {
    const { data } = await this.load(userId);
    const status = paused ? 'PAUSED' : missingRequired(data).length ? 'INCOMPLETE' : 'ACTIVE';
    await this.prisma.profile.update({ where: { userId }, data: { status } });
    return { status };
  }

  /** Called when sensitive-data consent is withdrawn. */
  async purgeSensitive(userId: string) {
    const { row, data } = await this.load(userId);
    if (!row || !data.values) return;
    const { patch } = stripSensitive({ values: data.values });
    const values = patch.values && Object.keys(patch.values).length ? patch.values : undefined;
    await this.prisma.profile.update({
      where: { userId },
      data: { valuesEnc: values ? this.crypto.encryptJson(values) : null },
    });
    const drafts = await this.prisma.profileDraft.findMany({ where: { userId, status: 'PENDING' } });
    for (const d of drafts) {
      const p = stripSensitive(this.crypto.decryptJson<ProfileData>(d.patchEnc) ?? {}).patch;
      await this.prisma.profileDraft.update({ where: { id: d.id }, data: { patchEnc: this.crypto.encryptJson(p) } });
    }
  }
}
