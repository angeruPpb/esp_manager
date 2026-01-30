import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { EspService } from '../esp/esp.service';
import { EspGateway } from '../esp/esp.gateway';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
private readonly BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
private readonly USERNAME = process.env.MQTT_USERNAME || 'nodejs_server';
private readonly PASSWORD = process.env.MQTT_PASSWORD || 'char5524';
  
  private updateTimeouts: Map<string, NodeJS.Timeout> = new Map();
  
  // ✅ NUEVO: Prevenir envíos duplicados
  private sendingUpdates: Set<string> = new Set();

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
    
    this.updateTimeouts.forEach(timeout => clearTimeout(timeout));
    this.updateTimeouts.clear();
    this.sendingUpdates.clear();
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

      this.client.subscribe('esp32/heartbeat/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/heartbeat/+');
      });

      this.client.subscribe('esp32/download/complete/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/download/complete/+');
      });

      this.client.subscribe('esp32/update_status/+', (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/update_status/+');
      });

      this.client.subscribe('esp32/command/+/register_assistance', { qos: 1 }, (err) => {
        if (!err) console.log('📥 Suscrito a: esp32/command/+/register_assistance');
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

      if (topic.startsWith('esp32/heartbeat/')) {
        const apiKey = data.apiKey || topic.split('/')[2];
        await this.handleHeartbeat(apiKey, data);
      }
      else if (topic.startsWith('esp32/download/complete/')) {
        const apiKey = data.apiKey || topic.split('/')[3];
        await this.handleDownloadComplete(apiKey, data);
      }
      else if (topic.startsWith('esp32/update_status/')) {
        const apiKey = data.apiKey || topic.split('/')[2];
        await this.handleUpdateStatus(apiKey, data);
      }
      else if (topic.includes('/register_assistance')) {
        const apiKey = topic.split('/')[2];
        await this.handleRegisterAssistance(apiKey, data);
      }
      else {
        console.log(`⚠️ Topic no reconocido: ${topic}`);
      }
    } catch (error) {
      console.error('❌ Error procesando mensaje MQTT:', error);
      console.error('   Payload recibido:', payload);
    }
  }

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
      this.espGateway.broadcastDeviceStatus();
    } catch (error) {
      console.log(`❌ Heartbeat de dispositivo no autorizado (${apiKey})`);
    }
  }

  private async handleRegisterAssistance(
  apiKey: string,
  data: {
    dni: string;
    type_assistance: string;
    timestamp: string;
    device: string;
  }
) {
  try {
    // Validar que el dispositivo existe
    const device = this.espService.validateDevice(apiKey);

    // ✅ Imprimir mensaje recibido
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│ 📋 REGISTRO DE ASISTENCIA RECIBIDO                 │');
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│ 🆔 DNI:           ${data.dni.padEnd(33)} │`);
    console.log(`│ 📌 Tipo:          ${data.type_assistance.padEnd(33)} │`);
    console.log(`│ ⏰ Hora:          ${data.timestamp.padEnd(33)} │`);
    console.log(`│ 🏫 Dispositivo:   ${data.device.padEnd(33)} │`);
    console.log(`│ 📱 ESP32:         ${device.name.padEnd(33)} │`);
    console.log('└─────────────────────────────────────────────────────┘');

    // ✅ Enviar PUBACK (confirmación de recepción)
    const ackTopic = `esp32/ack/${apiKey}/register_assistance`;
    const ackPayload = {
      status: 'received',
      dni: data.dni,
      timestamp: new Date().toISOString(),
      message: 'Asistencia registrada correctamente'
    };

    this.publish(ackTopic, ackPayload);
    console.log(`✅ PUBACK enviado a ${device.name} (topic: ${ackTopic})`);

  } catch (error) {
    console.log(`❌ Registro de asistencia de dispositivo no autorizado (${apiKey})`);
    console.log(`   Datos recibidos:`, JSON.stringify(data, null, 2));
  }
}

  // ========== UPDATE STATUS ==========
private async handleUpdateStatus(
  apiKey: string, 
  data: { 
    version?: string;           // ✅ Campo antiguo (opcional)
    newVersion?: string;        // ✅ Campo nuevo del ESP32
    oldVersion?: string;        // ✅ Información adicional
    status?: string;            // ✅ in_progress, success, failed
    success?: boolean;          // ✅ Campo legacy
    error?: string;
    timestamp?: number;
    fileSize?: number;
    message?: string;
  }
) {
  try {
    const device = this.espService.validateDevice(apiKey);

    // ✅ Obtener versión (priorizar newVersion)
    const targetVersion = data.newVersion || data.version;

    if (!targetVersion) {
      console.log(`⚠️ ${device.name} envió update_status sin versión`);
      console.log(`   Datos recibidos:`, JSON.stringify(data, null, 2));
      return;
    }

    // ✅ Determinar si fue exitoso (soportar ambos formatos)
    const isSuccess = data.status === 'success' || data.success === true;
    const isFailed = data.status === 'failed' || data.success === false;
    const isInProgress = data.status === 'in_progress';

    // ✅ Si está en progreso, solo registrar (no hacer nada más)
    if (isInProgress) {
      console.log(`🔄 ${device.name} está actualizando de v${data.oldVersion || '?'} a v${targetVersion}...`);
      return;
    }

    if (isSuccess) {
      console.log(`✅ ${device.name} se actualizó exitosamente a v${targetVersion}`);
      console.log(`   Versión anterior: v${data.oldVersion || 'desconocida'}`);
      console.log(`   Mensaje: ${data.message || 'N/A'}`);

      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      this.espService.confirmUpdateSuccess(apiKey, targetVersion);
      await this.espService.deleteFirmwareByDeviceAndVersion(device.id, targetVersion);

      this.espGateway.server.emit('device_updated', {
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        oldVersion: data.oldVersion,
        timestamp: data.timestamp || Date.now(),
      });

      this.espGateway.broadcastDeviceStatus();
      this.espGateway.broadcastFirmwareUpdate();
    } 
    else if (isFailed) {
      const errorMsg = data.error || data.message || 'Error desconocido durante la actualización';
      console.log(`❌ ${device.name} falló al actualizar a v${targetVersion}: ${errorMsg}`);

      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        status: 'failed',
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      this.espService.markUpdateFailed(apiKey, errorMsg);
      this.espGateway.broadcastDeviceStatus();
    }
    else {
      console.log(`⚠️ ${device.name} envió update_status con estado desconocido:`, data.status);
    }
  } catch (error) {
    console.log('❌ Error procesando update_status:', error);
  }
}

// ========== DOWNLOAD COMPLETE ==========
private async handleDownloadComplete(
  apiKey: string, 
  data: { 
    version?: string;           // ✅ Campo antiguo (opcional)
    newVersion?: string;        // ✅ Campo del ESP32
    success: boolean;
    error?: string;
    timestamp?: number;
    fileSize?: number;          // ✅ Tamaño del archivo descargado
    message?: string;           // ✅ Mensaje adicional
  }
) {
  try {
    const device = this.espService.validateDevice(apiKey);
    
    // ✅ Obtener versión (priorizar newVersion)
    const targetVersion = data.newVersion || data.version;

    if (!targetVersion) {
      console.log(`⚠️ ${device.name} envió download_complete sin versión`);
      console.log(`   Datos recibidos:`, JSON.stringify(data, null, 2));
      return;
    }

    // ✅ Remover de lista de envíos en progreso
    this.sendingUpdates.delete(apiKey);

    if (this.updateTimeouts.has(apiKey)) {
      clearTimeout(this.updateTimeouts.get(apiKey));
      this.updateTimeouts.delete(apiKey);
      console.log(`⏱️ Timeout cancelado para ${device.name}`);
    }

    if (data.success) {
      console.log(`✅ ${device.name} completó la descarga de v${targetVersion}`);
      console.log(`   Tamaño del archivo: ${data.fileSize ? (data.fileSize / 1024).toFixed(2) + ' KB' : 'N/A'}`);
      console.log(`   Mensaje: ${data.message || 'Download successful'}`);

      this.espGateway.server.emit('download_complete', {
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        fileSize: data.fileSize,
        timestamp: data.timestamp || Date.now(),
      });
    } else {
      const errorMsg = data.error || data.message || 'Error desconocido';
      console.log(`❌ ${device.name} falló al descargar v${targetVersion}: ${errorMsg}`);

      await this.espService.addUpdateHistory({
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        status: 'failed',
        error: `Download failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      });

      this.espGateway.server.emit('download_failed', {
        deviceId: device.id,
        deviceName: device.name,
        version: targetVersion,
        error: errorMsg,
      });

      this.espGateway.broadcastDeviceStatus();
    }
  } catch (error) {
    console.log(`❌ Dispositivo no autorizado intentó reportar descarga completada`);
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

      // ✅ PREVENIR ENVÍOS DUPLICADOS
      if (this.sendingUpdates.has(apiKey)) {
        console.log(`⚠️ Ya se está enviando una actualización a ${device.name}, ignorando solicitud duplicada`);
        return { success: false, message: 'Actualización ya en progreso' };
      }

      // ✅ Marcar como enviando
      this.sendingUpdates.add(apiKey);

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

      // ✅ TIMEOUT: 60 segundos
      const timeout = setTimeout(async () => {
        console.log(`⏱️ TIMEOUT: ${device.name} no respondió en 60 segundos`);
        
        // ✅ Remover de lista de envíos
        this.sendingUpdates.delete(apiKey);
        
        await this.espService.addUpdateHistory({
          deviceId: device.id,
          deviceName: device.name,
          version: firmwareData.version,
          status: 'failed',
          error: 'Timeout: No response from device (60s)',
          timestamp: new Date().toISOString(),
        });

        this.espGateway.server.emit('update_timeout', {
          deviceId: device.id,
          deviceName: device.name,
          version: firmwareData.version,
        });

        this.updateTimeouts.delete(apiKey);
      }, 60000);

      this.updateTimeouts.set(apiKey, timeout);
      console.log(`⏱️ Timeout de 60s iniciado para ${device.name}`);

      return { success: true, message: 'Comando enviado' };
    } catch (error) {
      // ✅ Limpiar en caso de error
      this.sendingUpdates.delete(apiKey);
      console.log(`❌ Error enviando comando de actualización: ${error.message}`);
      throw error;
    }
  }

  publish(topic: string, payload: any) {
    if (this.client && this.client.connected) {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
      console.log(`📤 MQTT publicado en ${topic}`);
    } else {
      console.error('❌ Cliente MQTT no conectado');
    }
  }
}