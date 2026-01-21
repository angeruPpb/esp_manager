import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { EspController } from './esp.controller';
import { EspService } from './esp.service';
import { existsSync, mkdirSync } from 'fs';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(__dirname, '..', '..', 'uploads', 'firmware');
          
          // Crear directorio si no existe
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          // Multer procesa el archivo ANTES del body parser
          // Por eso no podemos acceder a req.body.version aquí
          // Solución: usar timestamp y renombrar después en el service
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
  providers: [EspService],
})
export class EspModule {}