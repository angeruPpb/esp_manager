import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EspService, Firmware } from './esp.service';
import { EspGateway } from './esp.gateway';

@Controller('esp/firmware')
export class EspController {
  constructor(
    private readonly espService: EspService,
    private readonly espGateway: EspGateway,
  ) {}

  // Solo mantener upload HTTP porque WebSocket no maneja archivos bien
  @Post('upload')
  @UseInterceptors(FileInterceptor('firmware'))
  async uploadFirmware(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { version: string; description: string; deviceId: string },
  ): Promise<{ success: boolean; firmware: Firmware }> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    if (!body.deviceId) {
      throw new BadRequestException('Debe seleccionar un dispositivo');
    }

    const result = await this.espService.saveFirmware(file, body);
    
    // Notificar a todos los clientes conectados
    this.espGateway.notifyFirmwareUploaded(result.firmware);

    return result;
  }
}