import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { EspService, Device, Firmware } from './esp.service';

@Injectable()
@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class EspGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
    
    // Guardar dispositivos conectados: Map<apiKey, Socket>
    private connectedDevices: Map<string, Socket> = new Map();

    constructor(private readonly espService: EspService) { }

    handleConnection(client: Socket) {
        console.log(`🔌 Cliente conectado: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        console.log(`❌ Cliente desconectado: ${client.id}`);

        // Remover del Map si era un ESP32
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
        const firmwares = await this.espService.getFirmwareList();
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

    notifyFirmwareUploaded(firmware: Firmware) {
        this.server.emit('firmware_uploaded', firmware);
        this.broadcastFirmwareUpdate();
        
        // Notificar al dispositivo específico si está conectado
        this.notifyDeviceUpdate(firmware.deviceId);
    }

    // ========== ESP32 ==========

    @SubscribeMessage('esp32_register')
    async handleEsp32Register(
        @MessageBody() data: { apiKey: string; currentVersion: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const device = this.espService.validateDevice(data.apiKey);

            // Guardar socket del ESP32
            this.connectedDevices.set(data.apiKey, client);

            // Actualizar estado
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

        // ✅ LOG: Dispositivo consultando actualización
        console.log(`🔍 ${device.name} (v${data.currentVersion}) consultando actualizaciones...`);

        // Actualizar lastCheck
        this.espService.updateDeviceStatus(
            data.apiKey,
            data.currentVersion,
            client.handshake.address,
        );

        // Verificar si hay firmware pendiente para este dispositivo
        const pendingFirmware = await this.espService.getPendingFirmwareForDevice(device.id);

        if (pendingFirmware && this.compareVersions(pendingFirmware.version, data.currentVersion) > 0) {
            const baseUrl = `http://${client.handshake.headers.host}`;

            client.emit('update_available', {
                version: pendingFirmware.version,
                url: `${baseUrl}${pendingFirmware.url}`,
                size: pendingFirmware.size,
                description: pendingFirmware.description,
            });

            console.log(`📤 Actualización enviada a ${device.name}: v${pendingFirmware.version}`);

            return { updateAvailable: true, version: pendingFirmware.version };
        }

        // ✅ LOG: No hay actualización disponible
        console.log(`✅ ${device.name} está actualizado (v${data.currentVersion})`);

        return { updateAvailable: false };
    } catch (error) {
        // ✅ LOG: Error de autenticación
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

                // Guardar en historial
                await this.espService.addUpdateHistory({
                    deviceId: device.id,
                    deviceName: device.name,
                    version: data.version,
                    status: 'success',
                    timestamp: new Date().toISOString(),
                });

                // Actualizar versión del dispositivo
                this.espService.confirmUpdateSuccess(data.apiKey, data.version);

                // Eliminar el firmware del servidor
                await this.espService.deleteFirmwareByDeviceAndVersion(device.id, data.version);

                // Notificar a todos los clientes web
                this.server.emit('device_updated', {
                    deviceId: device.id,
                    deviceName: device.name,
                    version: data.version,
                });

                this.broadcastDeviceStatus();
                this.broadcastFirmwareUpdate();

            } else {
                console.log(`❌ ${device.name} falló al actualizar: ${data.error}`);

                // Guardar en historial como fallido
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

    private broadcastDeviceStatus() {
        this.espService.getDevices().then((devices) => {
            this.server.emit('devices_update', devices);
        });
    }

    private broadcastFirmwareUpdate() {
        this.espService.getFirmwareList().then((firmwares) => {
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