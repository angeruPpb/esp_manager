import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { EspService } from '../esp/esp.service';
import { EspGateway } from '../esp/esp.gateway';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly BROKER_URL = 'mqtt://192.168.1.24:1883';
  private readonly USERNAME = 'nodejs_server';
  private readonly PASSWORD = 'char5524';
  private readonly SERVER_URL = 'http://192.168.1.87:3000';
  
  // ✅ NUEVO: Mapa de timeouts para cada dispositivo
  private updateTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly espService: EspService,
    @Inject(forwardRef(() => EspGateway))
    private espGateway: EspGateway,
  ) {}

  async onModuleInit() {
    await this.connectToBroker();
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
    }
    
    // Limpiar timeouts
    this.updateTimeouts.forEach(timeout => clearTimeout(timeout));
    this.updateTimeouts.clear();
  }

  private async connectToBroker() {
    console.log('📡 Conectando a Mosquitto broker...');

    this.client = mqtt.connect(this.BROKER_URL, {
      username: this.USERNAME,
      password: this.PASSWORD,
      clientId: `nodejs_server_${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      console.log('✅ Conectado a Mosquitto broker');

      // Suscribirse a todos los topics de ESP32
      this.client.subscribe('esp32/heartbeat/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/heartbeat/+');
      });

      // ✅ NUEVO: Descarga completada
      this.client.subscribe('esp32/download/complete/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/download/complete/+');
      });

      this.client.subscribe('esp32/update_status/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/update_status/+');
      });
    });

    this.client.on('message', async (topic, message) => {
      await this.handleMessage(topic, message);
    });

    this.client.on('error', (error) => {
      console.error('❌ Error MQTT:', error);
    });

    this.client.on('offline', () => {
      console.warn('⚠️ Broker MQTT offline');
    });

    this.client.on('reconnect', () => {
      console.log('🔄 Reconectando a broker MQTT...');
    });
  }

  private async handleMessage(topic: string, message: Buffer) {
    const payload = message.toString();
    
    try {
      const data = JSON.parse(payload);

      // ========== HEARTBEAT ==========
      if (topic.startsWith('esp32/heartbeat/')) {
        const apiKey = data.apiKey || topic.split('/')[2];
        await this.handleHeartbeat(apiKey, data);
      }

      // ========== DOWNLOAD COMPLETE ==========
      else if (topic.startsWith('esp32/download/complete/')) {
        const apiKey = data.apiKey || topic.split('/')[3];
        await this.handleDownloadComplete(apiKey, data);
      }

      // ========== UPDATE STATUS ==========
      else if (topic.startsWith('esp32/update_status/')) {
        const apiKey = data.apiKey || topic.split('/')[2];
        await this.handleUpdateStatus(apiKey, data);
      }
      
      else {
        console.log(`⚠️ Topic no reconocido: ${topic}`);
      }
    } catch (error) {
      console.error('❌ Error procesando mensaje MQTT:', error);
      console.error('   Payload recibido:', payload);
    }
  }

  // ========== HEARTBEAT ==========
  private async handleHeartbeat(
    apiKey: string, 
    data: { 
      currentVersion: string; 
      ipAddress?: string;
      counter?: number;
      uptime?: number;
      heap?: number;
      timestamp?: number;
    }
  ) {
    try {
      const device = this.espService.validateDevice(apiKey);
      
      const ipAddress = data.ipAddress || 'unknown';
      
      console.log(
        `💓 Heartbeat #${data.counter || '?'} de ${device.name} ` +
        `(v${data.currentVersion}) desde ${ipAddress} ` +
        `[Uptime: ${data.uptime || 0}s, Heap: ${data.heap || 0} bytes]`
      );

      this.espService.updateDeviceStatus(apiKey, data.currentVersion, ipAddress);
      
      // Notificar al panel web vía WebSocket
      this.espGateway.broadcastDeviceStatus();
    } catch (error) {
      console.log(`❌ Heartbeat de dispositivo no autorizado (${apiKey})`);
    }
  }

  // ========== DOWNLOAD COMPLETE ==========
private async handleDownloadComplete(
  apiKey: string, 
  data: { 
    version: string; 
    success: boolean;
    error?: string;
    timestamp?: number 
  }
) {
  try {
    const device = this.espService.validateDevice(apiKey);
    
    // ✅ Validar que los datos sean correctos
    if (!data.version) {
      console.log(`⚠️ ${device.name} envió download_complete sin versión`);
      return;
    }

    // ✅ Cancelar timeout si existe
    if (this.updateTimeouts.has(apiKey)) {
      clearTimeout(this.updateTimeouts.get(apiKey));
      this.updateTimeouts.delete(apiKey);
      console.log(`⏱️ Timeout cancelado para ${device.name}`);
    }

    if (data.success) {
      console.log(`✅ ${device.name} completó la descarga de v${data.version}`);

      // Notificar al panel web que la descarga fue exitosa
      this.espGateway.server.emit('download_complete', {
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        timestamp: data.timestamp || Date.now(),
      });
    } else {
      console.log(`❌ ${device.name} falló al descargar v${data.version}: ${data.error || 'Error desconocido'}`);

      // Registrar fallo en historial
      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        status: 'failed',
        error: data.error || 'Download failed',
        timestamp: new Date().toISOString(),
      });

      // Notificar error al panel web
      this.espGateway.server.emit('download_failed', {
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        error: data.error || 'Error desconocido',
      });

      this.espGateway.broadcastDeviceStatus();
    }
  } catch (error) {
    console.log(`❌ Dispositivo no autorizado intentó reportar descarga completada`);
  }
}

// ========== UPDATE STATUS ==========
private async handleUpdateStatus(
  apiKey: string, 
  data: { 
    version: string; 
    success: boolean; 
    error?: string;
    timestamp?: number;
  }
) {
  try {
    const device = this.espService.validateDevice(apiKey);

    // ✅ Validar que los datos sean correctos
    if (!data.version) {
      console.log(`⚠️ ${device.name} envió update_status sin versión`);
      return;
    }

    // ✅ Validar que success sea boolean
    if (typeof data.success !== 'boolean') {
      console.log(`⚠️ ${device.name} envió update_status sin campo success válido`);
      return;
    }

    if (data.success) {
      console.log(`✅ ${device.name} se actualizó exitosamente a v${data.version}`);

      // ✅ Registrar en historial con fecha/hora
      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      this.espService.confirmUpdateSuccess(apiKey, data.version);
      await this.espService.deleteFirmwareByDeviceAndVersion(device.id, data.version);

      // Notificar al panel web
      this.espGateway.server.emit('device_updated', {
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        timestamp: data.timestamp || Date.now(),
      });

      this.espGateway.broadcastDeviceStatus();
      this.espGateway.broadcastFirmwareUpdate();
    } else {
      const errorMsg = data.error || 'Error desconocido durante la actualización';
      console.log(`❌ ${device.name} falló al actualizar a v${data.version}: ${errorMsg}`);

      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: data.version,
        status: 'failed',
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      this.espService.markUpdateFailed(apiKey, errorMsg);
      this.espGateway.broadcastDeviceStatus();
    }
  } catch (error) {
    console.log('❌ Error procesando update_status:', error);
  }
}


  // ========== ENVIAR ACTUALIZACIÓN MANUAL ==========
  async sendUpdateCommand(apiKey: string, firmwareData: {
    version: string;
    url: string;
    size: number;
    description: string;
  }) {
    try {
      const device = this.espService.validateDevice(apiKey);

      console.log(`📤 Enviando comando de actualización a ${device.name}...`);
      console.log(`   Versión: ${firmwareData.version}`);
      console.log(`   URL: ${firmwareData.url}`);

      const updatePayload = {
        version: firmwareData.version,
        url: firmwareData.url,
        size: firmwareData.size,
        description: firmwareData.description,
      };

      this.publish(`esp32/command/${apiKey}/update`, updatePayload);

      // ✅ TIMEOUT: 60 segundos para recibir download_complete
      const timeout = setTimeout(async () => {
        console.log(`⏱️ TIMEOUT: ${device.name} no respondió en 60 segundos`);
        
        // Registrar timeout en historial
        await this.espService.addUpdateHistory({
          deviceId: device.id,
          deviceName: device.name,
          version: firmwareData.version,
          status: 'failed',
          error: 'Timeout: No response from device (60s)',
          timestamp: new Date().toISOString(),
        });

        // Notificar al panel web
        this.espGateway.server.emit('update_timeout', {
          deviceId: device.id,
          deviceName: device.name,
          version: firmwareData.version,
        });

        this.updateTimeouts.delete(apiKey);
      }, 60000); // 60 segundos

      this.updateTimeouts.set(apiKey, timeout);
      console.log(`⏱️ Timeout de 60s iniciado para ${device.name}`);

      return { success: true, message: 'Comando enviado' };
    } catch (error) {
      console.log(`❌ Error enviando comando de actualización: ${error.message}`);
      throw error;
    }
  }

  // ========== PUBLICAR MENSAJE ==========
  publish(topic: string, payload: any) {
    if (this.client && this.client.connected) {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
      console.log(`📤 MQTT publicado en ${topic}`);
    } else {
      console.error('❌ Cliente MQTT no conectado');
    }
  }

  // ========== COMPARAR VERSIONES ==========
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