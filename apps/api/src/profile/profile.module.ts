import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { LocalPhotoStorage, PHOTO_STORAGE } from './photo-storage';
import { PhotosService } from './photos.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Global()
@Module({
  controllers: [ProfileController],
  providers: [
    ProfileService,
    PhotosService,
    { provide: PHOTO_STORAGE, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new LocalPhotoStorage(c.UPLOAD_DIR) },
  ],
  exports: [ProfileService, PhotosService, PHOTO_STORAGE],
})
export class ProfileModule {}
