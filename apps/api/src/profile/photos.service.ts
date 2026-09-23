import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PHOTOS_FIELD } from '@agentmatch/shared';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { PHOTO_STORAGE, PhotoStorage } from './photo-storage';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

function sniffMime(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {}

  async upload(userId: string, file: { buffer: Buffer; size: number } | undefined) {
    if (!file) throw new BadRequestException('file is required');
    if (file.size > MAX_BYTES) throw new BadRequestException('Photo must be at most 5 MB');
    const mime = sniffMime(file.buffer);
    if (!mime || !ALLOWED.has(mime)) throw new BadRequestException('Only JPEG, PNG or WebP photos');
    const count = await this.prisma.photo.count({ where: { userId } });
    if (count >= PHOTOS_FIELD.max) throw new BadRequestException(`At most ${PHOTOS_FIELD.max} photos`);
    const storageKey = `${userId}-${this.crypto.randomToken(12)}`;
    // Photos are encrypted at rest like other personal data.
    await this.storage.put(storageKey, Buffer.from(this.crypto.encrypt(file.buffer.toString('base64'))));
    // MVP: auto-approve; moderators can reject from the admin queue.
    const photo = await this.prisma.photo.create({
      data: { userId, storageKey, mimeType: mime, position: count, moderation: 'APPROVED' },
    });
    return { id: photo.id, position: photo.position };
  }

  async remove(userId: string, id: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id, userId } });
    if (!photo) throw new NotFoundException();
    await this.prisma.photo.delete({ where: { id } });
    await this.storage.delete(photo.storageKey);
    return { ok: true };
  }

  /** Owner, or a user the owner explicitly disclosed photos to after a mutual like. */
  async canView(viewerId: string, ownerId: string): Promise<boolean> {
    if (viewerId === ownerId) return true;
    const disclosure = await this.prisma.disclosure.findFirst({
      where: { fromUserId: ownerId, toUserId: viewerId, fields: { has: 'photos' }, match: { status: 'MUTUAL' } },
    });
    return !!disclosure;
  }

  async read(viewerId: string, id: string, isModerator = false) {
    const photo = await this.prisma.photo.findUnique({ where: { id } });
    if (!photo) throw new NotFoundException();
    if (!isModerator && !(await this.canView(viewerId, photo.userId))) throw new ForbiddenException();
    if (!isModerator && photo.userId !== viewerId && photo.moderation !== 'APPROVED') throw new NotFoundException();
    const enc = (await this.storage.get(photo.storageKey)).toString();
    return { mimeType: photo.mimeType, data: Buffer.from(this.crypto.decrypt(enc), 'base64') };
  }

  async listVisible(viewerId: string, ownerId: string): Promise<string[]> {
    if (!(await this.canView(viewerId, ownerId))) return [];
    const photos = await this.prisma.photo.findMany({
      where: { userId: ownerId, moderation: 'APPROVED' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return photos.map((p) => p.id);
  }
}
