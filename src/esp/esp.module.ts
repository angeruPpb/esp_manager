import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { EspController } from './esp.controller';
import { EspService } from './esp.service';
import { EspGateway } from './esp.gateway'; // ← Verificar que el path sea correcto
import { existsSync, mkdirSync } from 'fs';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(__dirname, '..', '..', 'uploads', 'firmware');
          
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now();
          const filename = `temp_${uniqueSuffix}${extname(file.originalname)}`;
          cb(null, filename);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (extname(file.originalname) !== '.bin') {
          return cb(new Error('Solo se permiten archivos .bin'), false);
        }
        cb(null, true);
      },
    }),
  ],
  controllers: [EspController],
  providers: [EspService, EspGateway], // ← EspGateway DEBE estar aquí
})
export class EspModule {}