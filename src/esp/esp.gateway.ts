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

    constructor(
        private readonly espService: EspService,
        @Inject(forwardRef(() => MqttService))
        private readonly mqttService: MqttService,
    ) { }

    handleConnection(client: Socket) {
        console.log(`🔌 Cliente conectado: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        console.log(`❌ Cliente desconectado: ${client.id}`);
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
        client.emit('devices_update', devices);
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
    notifyFirmwareUploaded(firmware: Firmware) {
        this.server.emit('firmware_uploaded', firmware);
        this.broadcastFirmwareUpdate();
    }

    // ========== MÉTODOS PRIVADOS ==========

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