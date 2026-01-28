import { Injectable, UnauthorizedException } from '@nestjs/common';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
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

export interface UpdateHistory {
  id: string;
  deviceId: string;
  deviceName: string;
  version: string;
  status: 'success' | 'failed';
  error?: string;
  timestamp: string;
}

@Injectable()
export class EspService {
  // ✅ Rutas corregidas
  private readonly devicesFile = join(process.cwd(), 'data', 'devices.json');
  private readonly firmwareFile = join(process.cwd(), 'data', 'firmware.json');
  private readonly historyFile = join(process.cwd(), 'data', 'history.json');
  private readonly uploadDir = join(process.cwd(), 'public', 'uploads');

  constructor() {
    // Asegurar que existan las carpetas necesarias
    const dataDir = join(process.cwd(), 'data');
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    const firmwareDir = join(uploadsDir, 'firmware');

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }

    if (!existsSync(firmwareDir)) {
      mkdirSync(firmwareDir, { recursive: true });
    }

    // Crear archivos JSON si no existen
    if (!existsSync(this.devicesFile)) {
      writeFileSync(this.devicesFile, JSON.stringify([], null, 2));
    }

    if (!existsSync(this.firmwareFile)) {
      writeFileSync(this.firmwareFile, JSON.stringify([], null, 2));
    }

    if (!existsSync(this.historyFile)) {
      writeFileSync(this.historyFile, JSON.stringify([], null, 2));
    }
  }

  // ========== MÉTODOS PRIVADOS DE BASE DE DATOS ==========

  private getFirmwareList(): Firmware[] {
    const data = readFileSync(this.firmwareFile, 'utf-8');
    return JSON.parse(data);
  }

  private saveFirmwareList(data: Firmware[]): void {
    writeFileSync(this.firmwareFile, JSON.stringify(data, null, 2));
  }

  private getDevicesDb(): Device[] {
    const data = readFileSync(this.devicesFile, 'utf-8');
    return JSON.parse(data);
  }

  private saveDevicesDb(data: Device[]): void {
    writeFileSync(this.devicesFile, JSON.stringify(data, null, 2));
  }

  private getHistoryDb(): UpdateHistory[] {
    const data = readFileSync(this.historyFile, 'utf-8');
    return JSON.parse(data);
  }

  private saveHistoryDb(data: UpdateHistory[]): void {
    writeFileSync(this.historyFile, JSON.stringify(data, null, 2));
  }

  // ========== DISPOSITIVOS ==========

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

  getDeviceById(deviceId: string): Device | null {
    const devices = this.getDevicesDb();
    return devices.find(d => d.id === deviceId) || null;
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
      devices[deviceIndex].currentVersion = currentVersion;
      devices[deviceIndex].lastCheck = new Date().toISOString();
      
      if (ipAddress) {
        devices[deviceIndex].ipAddress = ipAddress;
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

  // ✅ NUEVO: Marcar dispositivo como actualizado (sin firmware pendiente)
  markDeviceUpToDate(deviceId: string) {
    const devices = this.getDevicesDb();
    const deviceIndex = devices.findIndex(d => d.id === deviceId);

    if (deviceIndex !== -1) {
      devices[deviceIndex].lastUpdateStatus = 'none';
      this.saveDevicesDb(devices);
      console.log(`✅ Dispositivo ${devices[deviceIndex].name} marcado como actualizado (sin firmware pendiente)`);
    }
  }

  // ========== FIRMWARE ==========

  async saveFirmware(
    file: Express.Multer.File, 
    metadata: { version: string; description: string; deviceId: string }
  ): Promise<{ success: boolean; firmware: Firmware }> {
    const firmwares = this.getFirmwareList();

    // ✅ Directorio de firmware
    const firmwareDir = join(this.uploadDir, 'firmware');

    // Asegurar que el directorio existe
    if (!existsSync(firmwareDir)) {
      mkdirSync(firmwareDir, { recursive: true });
    }

    // Generar nombre único para el archivo
    const timestamp = Date.now();
    const filename = `${metadata.deviceId}_v${metadata.version}_${timestamp}.bin`;
    const filepath = join(firmwareDir, filename);

    // Guardar archivo
    writeFileSync(filepath, file.buffer);

    const firmware: Firmware = {
      id: timestamp.toString(),
      deviceId: metadata.deviceId,
      version: metadata.version,
      filename,
      url: `/uploads/firmware/${filename}`,
      size: file.size,
      description: metadata.description,
      uploadDate: new Date().toISOString(),
    };

    firmwares.push(firmware);
    this.saveFirmwareList(firmwares);

    // Marcar dispositivo como pendiente de actualización
    this.markUpdatePending(metadata.deviceId);

    console.log(`✅ Firmware guardado: ${filename} para dispositivo ${metadata.deviceId}`);

    return { success: true, firmware };
  }

  async getFirmwares(): Promise<Firmware[]> {
    return this.getFirmwareList();
  }

  async getPendingFirmwareForDevice(deviceId: string): Promise<Firmware | null> {
    const firmwares = this.getFirmwareList();
    const deviceFirmwares = firmwares.filter(f => f.deviceId === deviceId);
    
    if (deviceFirmwares.length === 0) return null;

    // Retornar el firmware más reciente
    return deviceFirmwares.sort((a, b) => 
      new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    )[0];
  }

  async deleteFirmware(id: string) {
    const firmwares = this.getFirmwareList();
    const firmware = firmwares.find(f => f.id === id);

    if (!firmware) {
      return { success: false, message: 'Firmware no encontrado' };
    }

    // ✅ Verificar si hay más firmwares pendientes para este dispositivo
    const deviceFirmwares = firmwares.filter(
      f => f.deviceId === firmware.deviceId && f.id !== firmware.id
    );

    // ✅ Si no hay más firmwares pendientes, marcar dispositivo como actualizado
    if (deviceFirmwares.length === 0) {
      this.markDeviceUpToDate(firmware.deviceId);
    }

    // ✅✅✅ Eliminar archivo físico
    const filePath = join(this.uploadDir, 'firmware', firmware.filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);  // 🔥 ESTO ELIMINA EL ARCHIVO
    }

    // Eliminar de la base de datos
    const newFirmwares = firmwares.filter(f => f.id !== id);
    this.saveFirmwareList(newFirmwares);

    console.log(`🗑️ Firmware eliminado: ${firmware.filename}`);

    return { success: true, message: 'Firmware eliminado' };
}

  async deleteFirmwareByDeviceAndVersion(deviceId: string, version: string) {
    const firmwares = this.getFirmwareList();
    const firmware = firmwares.find(f => f.deviceId === deviceId && f.version === version);

    if (firmware) {
      const filePath = join(this.uploadDir, 'firmware', firmware.filename);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }

      const newFirmwares = firmwares.filter(f => f.id !== firmware.id);
      this.saveFirmwareList(newFirmwares);

      console.log(`🗑️ Firmware v${version} eliminado después de actualización exitosa`);
    }
  }

  // ========== HISTORIAL ==========

  async addUpdateHistory(data: Omit<UpdateHistory, 'id'>): Promise<UpdateHistory> {
    const history = this.getHistoryDb();
    
    const entry: UpdateHistory = {
      id: Date.now().toString(),
      ...data,
    };

    history.push(entry);
    this.saveHistoryDb(history);

    return entry;
  }

  async getUpdateHistory(): Promise<UpdateHistory[]> {
    return this.getHistoryDb().sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  // ========== UTILIDADES ==========

  private generateApiKeyFromName(name: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(name.toLowerCase().trim())
      .digest('hex');
    
    const shortHash = hash.substring(0, 32);
    
    return `esp32_${shortHash}`;
  }
  public compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace('v', '').split('.').map(Number);
    const parts2 = v2.replace('v', '').split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  }
}