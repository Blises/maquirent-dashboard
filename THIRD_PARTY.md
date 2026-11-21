# Bibliotecas y servicios

| Componente | Versión | Uso y procedencia |
| --- | --- | --- |
| MQTT.js | 4.3.7 | Cliente MQTT del navegador. [Repositorio](https://github.com/mqttjs/MQTT.js), licencia MIT en `assets/vendor/MQTT-LICENSE.md`. |
| Leaflet | 1.9.4 | Mapa interactivo. [Sitio oficial](https://leafletjs.com/), licencia BSD-2-Clause en `assets/vendor/leaflet/LICENSE`. |
| Eclipse Paho MQTT Python | 2.1.0 | Cliente del gateway. [Repositorio](https://github.com/eclipse-paho/paho.mqtt.python), EPL-2.0 o EDL-1.0. Se instala mediante pip. |
| pySerial | 3.5 | Acceso USB serial. [Repositorio](https://github.com/pyserial/pyserial), licencia BSD. Se instala mediante pip. |
| MicroPython, `onewire` y `ds18x20` | Según la instalación RP2 | Ejecución y adquisición en la Pico. [Documentación RP2](https://docs.micropython.org/en/latest/rp2/quickref.html). No se distribuye el firmware de MicroPython en este repositorio. |
| EMQX | Servicio público | [Conexiones y puertos](https://www.emqx.com/en/mqtt/public-mqtt5-broker). |
| Esri | Servicio de mapas | Teselas de calles, satélite y gris oscuro; atribución visible en el mapa. [Condiciones](https://www.esri.com/en-us/legal/terms/full-master-agreement). |

Las copias de MQTT.js y Leaflet proceden de sus paquetes publicados en npm, descargados desde unpkg con una versión fija. No se ha reutilizado código de los repositorios de ejemplo de calidad del aire.
