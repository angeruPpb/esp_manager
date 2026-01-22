import { Injectable, UnauthorizedException } from '@nestjs/common';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

export interface Firmware {
  id: string;
  version: string;
  description: string;
  filename: string;
  url: string;
  uploadDate: string;
  size: number;
  deviceId: string;
}

export interface Device {
  id: string;
  name: string;
  apiKey: string;
  currentVersion: string;
  lastCheck: string;
  ipAddress: string;
  registered: string;
  lastUpdateStatus?: 'success' | 'failed' | 'pending' | 'none';
  lastUpdateDate?: string;
}

@Injectable()
export class EspService {
  private readonly dbPath = join(__dirname, '..', '..', 'uploads', 'firmware', 'db.json');
  private readonly devicesDbPath = join(__dirname, '..', '..', 'uploads', 'firmware', 'devices.json');
  private readonly uploadsDir = join(__dirname, '..', '..', 'uploads', 'firmware');

  constructor() {
    if (!existsSync(this.uploadsDir)) {
      mkdirSync(this.uploadsDir, { recursive: true });
    }

    if (!existsSync(this.dbPath)) {
      this.saveDb([]);
    }

    if (!existsSync(this.devicesDbPath)) {
      this.saveDevicesDb([]);
    }
  }

  private getDb(): Firmware[] {
    const data = readFileSync(this.dbPath, 'utf-8');
    return JSON.parse(data);
  }

  private saveDb(data: Firmware[]): void {
    writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  private getDevicesDb(): Device[] {
    const data = readFileSync(this.devicesDbPath, 'utf-8');
    return JSON.parse(data);
  }

  private saveDevicesDb(data: Device[]): void {
    writeFileSync(this.devicesDbPath, JSON.stringify(data, null, 2));
  }

  async registerDevice(name: string): Promise<{ device: Device; isNew: boolean }> {
    const devices = this.getDevicesDb();
    
    const existingDevice = devices.find(d => d.name.toLowerCase() === name.toLowerCase());
    
    if (existingDevice) {
      return { 
        device: existingDevice, 
        isNew: false 
      };
    }

    const apiKey = this.generateApiKeyFromName(name);

    // Genera un ID único simple
    const device: Device = {
      id: Date.now().toString(),
      name,
      apiKey,
      currentVersion: '0.0.0',
      lastCheck: new Date().toISOString(),
      ipAddress: '',
      registered: new Date().toISOString(),
      lastUpdateStatus: 'none',
      lastUpdateDate: '',
    };

    devices.push(device);
    this.saveDevicesDb(devices);

    return { device, isNew: true };
  }

  async getDevices(): Promise<Device[]> {
    return this.getDevicesDb();
  }

  async deleteDevice(id: string) {
    const devices = this.getDevicesDb();
    const newDevices = devices.filter(d => d.id !== id);
    this.saveDevicesDb(newDevices);
    return { success: true, message: 'Dispositivo eliminado' };
  }

  validateDevice(apiKey: string): Device {
    const devices = this.getDevicesDb();
    const device = devices.find(d => d.apiKey === apiKey);

    if (!device) {
      throw new UnauthorizedException('Dispositivo no autorizado');
    }

    return device;
  }

  updateDeviceStatus(apiKey: string, currentVersion: string, ipAddress: string) {
    const devices = this.getDevicesDb();
    const deviceIndex = devices.findIndex(d => d.apiKey === apiKey);

    if (deviceIndex !== -1) {
      const previousVersion = devices[deviceIndex].currentVersion;
      
      devices[deviceIndex].currentVersion = currentVersion;
      devices[deviceIndex].lastCheck = new Date().toISOString();
      devices[deviceIndex].ipAddress = ipAddress;
      
      if (previousVersion !== currentVersion && previousVersion !== '0.0.0') {
        devices[deviceIndex].lastUpdateStatus = 'success';
        devices[deviceIndex].lastUpdateDate = new Date().toISOString();
      }
      
      this.saveDevicesDb(devices);
    }
  }

  confirmUpdateSuccess(apiKey: string, newVersion: string) {
    const devices = this.getDevicesDb();
    const deviceIndex = devices.findIndex(d => d.apiKey === apiKey);

    if (deviceIndex !== -1) {
      devices[deviceIndex].lastUpdateStatus = 'success';
      devices[deviceIndex].lastUpdateDate = new Date().toISOString();
      devices[deviceIndex].currentVersion = newVersion;
      this.saveDevicesDb(devices);
    }
  }

  markUpdateFailed(apiKey: string, error: string) {
    const devices = this.getDevicesDb();
    const deviceIndex = devices.findIndex(d => d.apiKey === apiKey);

    if (deviceIndex !== -1) {
      devices[deviceIndex].lastUpdateStatus = 'failed';
      devices[deviceIndex].lastUpdateDate = new Date().toISOString();
      this.saveDevicesDb(devices);
    }
  }

  markUpdatePending(deviceId: string) {
    const devices = this.getDevicesDb();
    const deviceIndex = devices.findIndex(d => d.id === deviceId);

    if (deviceIndex !== -1) {
      devices[deviceIndex].lastUpdateStatus = 'pending';
      this.saveDevicesDb(devices);
    }
  }

  async saveFirmware(
    file: Express.Multer.File, 
    metadata: { version: string; description: string; deviceId: string }
  ) {
    const db = this.getDb();
    
    const newFilename = `esp32_v${metadata.version}_${metadata.deviceId}.bin`;
    const oldPath = join(this.uploadsDir, file.filename);
    const newPath = join(this.uploadsDir, newFilename);
    
    renameSync(oldPath, newPath);
    
    const firmware: Firmware = {
      id: Date.now().toString(),
      version: metadata.version,
      description: metadata.description,
      filename: newFilename,
      url: `/uploads/firmware/${newFilename}`,
      uploadDate: new Date().toISOString(),
      size: file.size,
      deviceId: metadata.deviceId,
    };

    db.push(firmware);
    this.saveDb(db);

    this.markUpdatePending(metadata.deviceId);

    return { success: true, firmware };
  }

  async getFirmwareList() {
    return this.getDb();
  }

  async getLatestFirmwareForDevice(deviceId: string): Promise<Firmware | null> {
    const db = this.getDb();
    const deviceFirmwares = db.filter(f => f.deviceId === deviceId);
    
    if (deviceFirmwares.length === 0) return null;

    return deviceFirmwares.sort((a, b) => 
      new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    )[0];
  }

  async deleteFirmware(id: string) {
    const db = this.getDb();
    const firmware = db.find(f => f.id === id);

    if (!firmware) {
      return { success: false, message: 'Firmware no encontrado' };
    }

    const filePath = join(this.uploadsDir, firmware.filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    const newDb = db.filter(f => f.id !== id);
    this.saveDb(newDb);

    return { success: true, message: 'Firmware eliminado' };
  }

  private generateApiKeyFromName(name: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(name.toLowerCase().trim())
      .digest('hex');
    
    const shortHash = hash.substring(0, 32);
    
    return `esp32_${shortHash}`;
  }
}