import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as os from 'os';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Configurar carpeta para archivos estáticos (HTML, CSS, JS)
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/',
  });

  // Configurar carpeta para firmwares descargables
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Habilitar CORS para ESP32
  app.enableCors();

  const port = 3000;
  await app.listen(port, '0.0.0.0');

  // Obtener IPs de red
  const networkInterfaces = os.networkInterfaces();
  const ips: string[] = [];

  Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName]?.forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    });
  });

  console.log('\n🚀 Servidor ESP32 OTA Manager iniciado\n');
  console.log(`   Local:    http://localhost:${port}`);
  
  if (ips.length > 0) {
    ips.forEach(ip => {
      console.log(`   Red:      http://${ip}:${port}`);
    });
  }
  
  console.log('\n📱 Panel web disponible en las URLs de arriba');
  console.log('🔧 ESP32 debe usar la dirección de Red\n');
}

bootstrap();