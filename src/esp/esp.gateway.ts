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
    
    //Guardar dispositivos conectados
    private connectedDevices: Map<string, Socket> = new Map();

    constructor(private readonly espService: EspService) { }

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

    notifyFirmwareUploaded(firmware: Firmware) {
        this.server.emit('firmware_uploaded', firmware);
        this.broadcastFirmwareUpdate();
    }

    @SubscribeMessage('esp32_connect')
    async handleEsp32Connect(
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

            client.emit('esp32_connected', {
                success: true,
                device: device.name,
            });

            const latest = await this.espService.getLatestFirmwareForDevice(device.id);

            if (latest && this.compareVersions(latest.version, data.currentVersion) > 0) {
                const baseUrl = `http://${client.handshake.headers.host}`;

                client.emit('update_available', {
                    version: latest.version,
                    url: `${baseUrl}${latest.url}`,
                    size: latest.size,
                });
            }

            this.broadcastDeviceStatus();

            return { success: true };
        } catch (error) {
            client.emit('error', { message: 'Dispositivo no autorizado' });
            client.disconnect();
            return { success: false };
        }
    }

    @SubscribeMessage('esp32_heartbeat')
    async handleEsp32Heartbeat(
        @MessageBody() data: { apiKey: string; currentVersion: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            this.espService.updateDeviceStatus(
                data.apiKey,
                data.currentVersion,
                client.handshake.address,
            );

            this.broadcastDeviceStatus();

            return { success: true };
        } catch (error) {
            return { success: false };
        }
    }

    @SubscribeMessage('update_complete')
    async handleUpdateComplete(
        @MessageBody() data: { apiKey: string; version: string; success: boolean; error?: string },
        @ConnectedSocket() client: Socket,
    ) {
        if (data.success) {
            this.espService.confirmUpdateSuccess(data.apiKey, data.version);
            this.server.emit('device_updated', {
                apiKey: data.apiKey,
                version: data.version,
            });
        } else {
            this.espService.markUpdateFailed(data.apiKey, data.error || 'Error desconocido');
        }

        this.broadcastDeviceStatus();
        return { success: true };
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