import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Query,
  Headers,
  Ip,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EspService, Firmware, Device } from './esp.service';

@Controller('esp/firmware')
export class EspController {
  constructor(private readonly espService: EspService) {}

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

    return this.espService.saveFirmware(file, body);
  }

  @Get('list')
  async listFirmwares(): Promise<Firmware[]> {
    return this.espService.getFirmwareList();
  }

  @Delete(':id')
  async deleteFirmware(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.espService.deleteFirmware(id);
  }

  // ============ ENDPOINT PARA ESP32 ============

  @Get('check-update')
  async checkUpdate(
    @Query('current_version') currentVersion: string,
    @Headers('x-api-key') apiKey: string,
    @Ip() ipAddress: string,
  ): Promise<{ 
    status: string;
    update_available?: boolean; 
    version?: string; 
    url?: string; 
    size?: number;
  }> {
    const device = this.espService.validateDevice(apiKey);
    this.espService.updateDeviceStatus(apiKey, currentVersion, ipAddress);

    const latest = await this.espService.getLatestFirmwareForDevice(device.id);
    
    if (!latest) {
      return { status: 'ok' };
    }

    if (this.compareVersions(latest.version, currentVersion) > 0) {
      return {
        status: 'update_available',
        update_available: true,
        version: latest.version,
        url: `${process.env.BASE_URL || 'http://192.168.1.4:3000'}${latest.url}`,
        size: latest.size,
      };
    }

    return { status: 'ok' };
  }

  // ============ GESTIÓN DE DISPOSITIVOS ============

  @Post('devices/register')
  async registerDevice(@Body() body: { name: string }): Promise<{ device: Device; isNew: boolean }> {
    return this.espService.registerDevice(body.name);
  }

  @Get('devices')
  async getDevices(): Promise<Device[]> {
    return this.espService.getDevices();
  }

  @Delete('devices/:id')
  async deleteDevice(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.espService.deleteDevice(id);
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace('v', '').split('.').map(Number);
    const parts2 = v2.replace('v', '').split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  }
}