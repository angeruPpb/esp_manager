import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { EspService, Device, Firmware } from './esp.service';
import { MqttService } from '../mqtt/mqtt.service';

@Injectable()
@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class EspGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
    
    private connectedDevices: Map<string, Socket> = new Map();

    constructor(
        private readonly espService: EspService, 
        @Inject(forwardRef(() => MqttService))
        private readonly mqttService: MqttService,
    ) {}

    handleConnection(client: Socket) {
        console.log(`🔌 Cliente conectado: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        console.log(`❌ Cliente desconectado: ${client.id}`);

        for (const [apiKey, socket] of this.connectedDevices.entries()) {
            if (socket.id === client.id) {
                this.connectedDevices.delete(apiKey);
                this.broadcastDeviceStatus();
                break;
            }
        }
    }

    // ========== PANEL WEB ==========

    @SubscribeMessage('register_device')
    async handleRegisterDevice(
        @MessageBody() data: { name: string },
        @ConnectedSocket() client: Socket,
    ) {
        const result = await this.espService.registerDevice(data.name);
        client.emit('device_registered', result);
        this.broadcastDeviceStatus();
        return result;
    }

    @SubscribeMessage('get_devices')
    async handleGetDevices(@ConnectedSocket() client: Socket) {
        const devices = await this.espService.getDevices();
        client.emit('devices_list', devices);
        return devices;
    }

    @SubscribeMessage('delete_device')
    async handleDeleteDevice(
        @MessageBody() data: { id: string },
        @ConnectedSocket() client: Socket,
    ) {
        const result = await this.espService.deleteDevice(data.id);
        this.broadcastDeviceStatus();
        return result;
    }

    @SubscribeMessage('get_firmwares')
    async handleGetFirmwares(@ConnectedSocket() client: Socket) {
        const firmwares = await this.espService.getFirmwares(); // ✅ Corregido: getFirmwares()
        client.emit('firmwares_list', firmwares);
        return firmwares;
    }

    @SubscribeMessage('delete_firmware')
    async handleDeleteFirmware(
        @MessageBody() data: { id: string },
        @ConnectedSocket() client: Socket,
    ) {
        const result = await this.espService.deleteFirmware(data.id);
        this.broadcastFirmwareUpdate();
        return result;
    }

    @SubscribeMessage('get_update_history')
    async handleGetUpdateHistory(@ConnectedSocket() client: Socket) {
        const history = await this.espService.getUpdateHistory();
        client.emit('update_history_list', history);
        return history;
    }

    // ✅ Método público para notificar nuevo firmware
    notifyFirmwareUploaded(firmware: Firmware) {
        this.server.emit('firmware_uploaded', firmware);
        this.broadcastFirmwareUpdate();
        this.notifyDeviceUpdate(firmware.deviceId);
    }

    // ========== ENVIAR FIRMWARE MANUAL ==========

@SubscribeMessage('send_firmware')
async handleSendFirmware(
  @MessageBody() data: { apiKey: string; firmwareId: string },
  @ConnectedSocket() client: Socket,
) {
  try {
    // ✅ Verificar que no se esté enviando ya una actualización a este dispositivo
    const device = this.espService.validateDevice(data.apiKey);
    
    // Obtener firmware
    const firmwares = await this.espService.getFirmwares();
    const firmware = firmwares.find(f => f.id === data.firmwareId);

    if (!firmware) {
      client.emit('firmware_send_error', { error: 'Firmware no encontrado' });
      return { success: false, error: 'Firmware no encontrado' };
    }

    // ✅ Construir URL del firmware
    const protocol = client.handshake.headers['x-forwarded-proto'] || 'http';
    const host = client.handshake.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    const firmwareUrl = `${baseUrl}${firmware.url}`;

    console.log(`📤 Enviando firmware v${firmware.version} a ${device.name}`);
    console.log(`   URL: ${firmwareUrl}`);

    // Enviar comando vía MQTT (esto retorna una promesa)
    const result = await this.mqttService.sendUpdateCommand(data.apiKey, {
      version: firmware.version,
      url: firmwareUrl,
      size: firmware.size,
      description: firmware.description,
    });

    // ✅ Notificar al cliente que el comando fue enviado
    client.emit('firmware_send_success', {
      deviceName: device.name,
      version: firmware.version,
    });

    return result;
  } catch (error) {
    console.error('❌ Error enviando firmware:', error);
    
    client.emit('firmware_send_error', { 
      error: error.message || 'Error desconocido' 
    });
    
    return { success: false, error: error.message };
  }
}

    // ========== ESP32 ==========

    @SubscribeMessage('esp32_register')
    async handleEsp32Register(
        @MessageBody() data: { apiKey: string; currentVersion: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const device = this.espService.validateDevice(data.apiKey);

            this.connectedDevices.set(data.apiKey, client);

            this.espService.updateDeviceStatus(
                data.apiKey,
                data.currentVersion,
                client.handshake.address,
            );

            this.broadcastDeviceStatus();

            client.emit('esp32_registered', {
                success: true,
                deviceName: device.name,
            });

            return { success: true };
        } catch (error) {
            client.emit('error', { message: 'Dispositivo no autorizado' });
            client.disconnect();
            return { success: false };
        }
    }

    @SubscribeMessage('esp32_check_update')
    async handleEsp32CheckUpdate(
        @MessageBody() data: { apiKey: string; currentVersion: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const device = this.espService.validateDevice(data.apiKey);

            console.log(`🔍 ${device.name} (v${data.currentVersion}) consultando actualizaciones...`);

            this.espService.updateDeviceStatus(
                data.apiKey,
                data.currentVersion,
                client.handshake.address,
            );

            const pendingFirmware = await this.espService.getPendingFirmwareForDevice(device.id);

            if (pendingFirmware && this.compareVersions(pendingFirmware.version, data.currentVersion) > 0) {
                const protocol = client.handshake.headers['x-forwarded-proto'] || 'http';
                const host = client.handshake.headers.host || 'localhost:3000';
                const baseUrl = `${protocol}://${host}`;

                client.emit('update_available', {
                    version: pendingFirmware.version,
                    url: `${baseUrl}${pendingFirmware.url}`,
                    size: pendingFirmware.size,
                    description: pendingFirmware.description,
                });

                console.log(`📤 Actualización enviada a ${device.name}: v${pendingFirmware.version}`);

                return { updateAvailable: true, version: pendingFirmware.version };
            }

            console.log(`✅ ${device.name} está actualizado (v${data.currentVersion})`);

            return { updateAvailable: false };
        } catch (error) {
            console.log(`❌ Dispositivo no autorizado intentó consultar actualizaciones`);
            return { success: false };
        }
    }

    @SubscribeMessage('update_status')
    async handleUpdateStatus(
        @MessageBody() data: { 
            apiKey: string; 
            version: string; 
            success: boolean; 
            error?: string 
        },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const device = this.espService.validateDevice(data.apiKey);

            if (data.success) {
                console.log(`✅ ${device.name} se actualizó exitosamente a v${data.version}`);

                await this.espService.addUpdateHistory({
                    deviceId: device.id,
                    deviceName: device.name,
                    version: data.version,
                    status: 'success',
                    timestamp: new Date().toISOString(),
                });

                this.espService.confirmUpdateSuccess(data.apiKey, data.version);

                await this.espService.deleteFirmwareByDeviceAndVersion(device.id, data.version);

                this.server.emit('device_updated', {
                    deviceId: device.id,
                    deviceName: device.name,
                    version: data.version,
                });

                this.broadcastDeviceStatus();
                this.broadcastFirmwareUpdate();

            } else {
                console.log(`❌ ${device.name} falló al actualizar: ${data.error}`);

                await this.espService.addUpdateHistory({
                    deviceId: device.id,
                    deviceName: device.name,
                    version: data.version,
                    status: 'failed',
                    error: data.error,
                    timestamp: new Date().toISOString(),
                });

                this.espService.markUpdateFailed(data.apiKey, data.error || 'Error desconocido');
                this.broadcastDeviceStatus();
            }

            return { success: true };
        } catch (error) {
            return { success: false };
        }
    }

    // ========== MÉTODOS PRIVADOS ==========

    private notifyDeviceUpdate(deviceId: string) {
        const device = this.espService.getDeviceById(deviceId);
        
        if (device && this.connectedDevices.has(device.apiKey)) {
            console.log(`🔔 Notificando a ${device.name} sobre nueva actualización disponible`);
        }
    }

    public broadcastDeviceStatus() {
        this.espService.getDevices().then((devices) => {
            this.server.emit('devices_update', devices);
        });
    }

    public broadcastFirmwareUpdate() {
        this.espService.getFirmwares().then((firmwares) => { // ✅ Corregido
            this.server.emit('firmwares_update', firmwares);
        });
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