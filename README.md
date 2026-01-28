# 🚀 ESP32 OTA Manager

Sistema completo de gestión de dispositivos ESP32 con actualización OTA (Over-The-Air) a través de MQTT, desarrollado con NestJS y desplegado con Docker.

---

## 📋 Descripción del Proyecto

**ESP32 OTA Manager** es una plataforma que permite:

- ✅ **Gestión centralizada** de dispositivos ESP32
- ✅ **Actualizaciones OTA** de firmware vía MQTT
- ✅ **Monitoreo en tiempo real** (heartbeat, estado de conexión)
- ✅ **Registro de asistencias** desde dispositivos ESP32
- ✅ **Panel web** para administración
- ✅ **Broker MQTT Mosquitto** con autenticación
- ✅ **Persistencia de datos** en JSON
- ✅ **WebSockets** para notificaciones en tiempo real

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                  ESP32 Devices (WiFi)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ ESP32 #1 │  │ ESP32 #2 │  │ ESP32 #N │           │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘           │
└────────┼─────────────┼─────────────┼────────────────┘
         │             │             │
         │ MQTT (1883) │             │
         └─────────────┴─────────────┘
                       │
         ┌─────────────▼──────────────────┐
         │    Docker Host (192.168.1.x)   │
         │  ┌──────────────────────────┐  │
         │  │   Mosquitto MQTT Broker  │  │
         │  │   Port: 1883, 9001       │  │
         │  └───────────┬──────────────┘  │
         │              │                 │
         │  ┌───────────▼──────────────┐  │
         │  │   NestJS Application     │  │
         │  │   Port: 3000             │  │
         │  │   - REST API             │  │
         │  │   - WebSocket Gateway    │  │
         │  │   - OTA Updates          │  │
         │  └──────────────────────────┘  │
         └────────────────────────────────┘
                       │
         ┌─────────────▼──────────────────┐
         │   Web Browser (Admin Panel)    │
         │   http://192.168.1.x:3000      │
         └────────────────────────────────┘
```

---

## 🛠️ Tecnologías Utilizadas

### **Backend**
- **NestJS** 10.x (TypeScript)
- **MQTT.js** (Cliente MQTT)
- **Socket.IO** (WebSockets)
- **Multer** (Carga de archivos)

### **Infraestructura**
- **Docker** & **Docker Compose**
- **Eclipse Mosquitto** 2.0 (Broker MQTT)
- **Node.js** 18 Alpine

### **Frontend**
- HTML5, CSS3, JavaScript vanilla
- Socket.IO Client
- Fetch API

## 🚀 Instalación y Despliegue

### **Requisitos previos**

- ✅ Docker Desktop instalado (Windows/Mac/Linux)
- ✅ Git instalado
- ✅ Puerto 1883, 3000, 9001 disponibles

---

### **1️⃣ Clonar el repositorio**

```bash
git clone https://github.com/angeruPpb/esp_manager.git
cd esp_manager
```

---

### **2️⃣ Configurar variables de entorno**

```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar con tus valores
nano .env  # o usar notepad, vim, etc.
```

**Ejemplo de `.env`:**

```env
# Entorno
NODE_ENV=production

# Puerto del servidor NestJS
PORT=3000

# Configuración MQTT
MQTT_BROKER_URL=mqtt://mosquitto:1883
MQTT_USERNAME=nodejs_server
MQTT_PASSWORD=tu_contraseña_segura_aqui

# Configuración de usuarios ESP32 (opcional, para documentación)
ESP32_MQTT_USERNAME=esp32_device
ESP32_MQTT_PASSWORD=otra_contraseña_segura
```

---

### **3️⃣ Crear directorios necesarios**

```bash
mkdir -p mosquitto/config mosquitto/data mosquitto/log
mkdir -p data public/uploads/firmware
```

---

### **4️⃣ Crear usuarios de Mosquitto**

#### **🪟 En Windows (PowerShell):**

```powershell
# Usuario para dispositivos ESP32
docker run --rm -v ${PWD}/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 `
  mosquitto_passwd -b /mosquitto/config/passwd esp32_device TU_CONTRASEÑA_AQUI

# Usuario para servidor NestJS
docker run --rm -v ${PWD}/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 `
  mosquitto_passwd -b /mosquitto/config/passwd nodejs_server TU_CONTRASEÑA_AQUI
```

#### **🐧 En Linux/Ubuntu:**

```bash
# Usuario para dispositivos ESP32
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 \
  mosquitto_passwd -b /mosquitto/config/passwd esp32_device TU_CONTRASEÑA_AQUI

# Usuario para servidor NestJS
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 \
  mosquitto_passwd -b /mosquitto/config/passwd nodejs_server TU_CONTRASEÑA_AQUI
```

---

### **5️⃣ Iniciar servicios con Docker Compose**

```bash
# Construir e iniciar contenedores
docker-compose up -d --build

# Ver logs en tiempo real
docker-compose logs -f

# Verificar estado
docker-compose ps
```

**Salida esperada:**

```
NAME              STATUS         PORTS
esp32_manager     Up (healthy)   0.0.0.0:3000->3000/tcp
esp32_mosquitto   Up (healthy)   0.0.0.0:1883->1883/tcp, 0.0.0.0:9001->9001/tcp
```

---

### **6️⃣ Acceder al panel web**

Abre tu navegador en:

```
http://localhost:3000
```

O desde otro dispositivo en la red local:

```
http://192.168.1.X:3000
```

*(Reemplaza `X` con la IP de tu servidor)*

---

## 🔐 Gestión de Usuarios MQTT (Mosquitto)

### **📌 Importante**
Todos los comandos deben ejecutarse desde el **directorio raíz del proyecto** (`esp_manager/`).

---

### **➕ Crear un nuevo usuario**

#### **Windows (PowerShell):**

```powershell
docker run --rm -v ${PWD}/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 `
  mosquitto_passwd -b /mosquitto/config/passwd NOMBRE_USUARIO CONTRASEÑA
```

#### **Linux/macOS:**

```bash
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 \
  mosquitto_passwd -b /mosquitto/config/passwd NOMBRE_USUARIO CONTRASEÑA
```

---

### **🔄 Cambiar contraseña de un usuario existente**

```bash
# El usuario debe existir previamente
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto:2.0 \
  mosquitto_passwd -b /mosquitto/config/passwd NOMBRE_USUARIO NUEVA_CONTRASEÑA
```

---

### **❌ Eliminar un usuario**

```bash
# Editar manualmente el archivo passwd
nano mosquitto/config/passwd

# O usar comando docker exec
docker exec esp32_mosquitto sh -c "sed -i '/^NOMBRE_USUARIO:/d' /mosquitto/config/passwd"
```

---

### **📋 Listar usuarios existentes**

```bash
# Ver contenido del archivo passwd
cat mosquitto/config/passwd
```

**Salida de ejemplo:**

```
esp32_device:$7$101$4PDw+c2sSeu/rrTD$2M0HoDPvfUx...
nodejs_server:$7$101$4FXfseMaXS1m5D61$wVUvn0gEbZK3...
esp32_sala1:$7$101$xyz123...
```

---

### **🔄 Aplicar cambios (reiniciar Mosquitto)**

Después de modificar usuarios, reinicia el broker:

```bash
docker-compose restart mosquitto
```

O si el contenedor está corriendo:

```bash
docker restart esp32_mosquitto
```

---

### **✅ Autenticación**

```bash
# Test de conexión (debe funcionar)
docker run --rm -it --network esp_manager_esp32_network eclipse-mosquitto:2.0 \
  mosquitto_sub -h mosquitto -p 1883 -u NOMBRE_USUARIO -P CONTRASEÑA -t test -v

# Test sin credenciales (debe fallar)
docker run --rm -it --network esp_manager_esp32_network eclipse-mosquitto:2.0 \
  mosquitto_sub -h mosquitto -p 1883 -t test -v
```
