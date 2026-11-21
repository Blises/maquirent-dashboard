"""Puente USB-MQTT. Un envío QoS 0 no confirma recepción en el suscriptor."""

import argparse
import json
import time
import uuid
import serial
import paho.mqtt.client as mqtt

PUERTO_COM = 'COM3'
BAUD_RATE = 115200
BROKER = 'broker.emqx.io'
PUERTO_MQTT = 1883
TOPICO = 'cucei/iot/d06/maquinaria/telemetria'


def extraer_json(linea):
    """Acepta un objeto JSON completo; ignora el texto de arranque del REPL."""
    inicio = linea.find('{')
    fin = linea.rfind('}') + 1
    if inicio < 0 or fin <= inicio:
        return None
    json_valido = linea[inicio:fin]
    try:
        datos = json.loads(json_valido)
    except (ValueError, TypeError):
        return None
    if not isinstance(datos, dict) or datos.get('equipo_id') != 'EXCAVADORA-CAT-01':
        return None
    return json_valido


def publicar_linea(client, linea):
    json_valido = extraer_json(linea)
    if json_valido is None:
        return False

    info = client.publish(TOPICO, json_valido, qos=0)
    if info.rc != mqtt.MQTT_ERR_SUCCESS:
        print('[ENVIO NO CONFIRMADO] ' + mqtt.error_string(info.rc))
        return False
    try:
        info.wait_for_publish(timeout=3)
    except (RuntimeError, ValueError) as error:
        print('[ENVIO NO CONFIRMADO]', error)
        return False
    if not info.is_published():
        print('[ENVIO PENDIENTE] No se confirmo la salida en el plazo de espera.')
        return False

    print('[ENVIADO POR CLIENTE MQTT - QoS 0]', TOPICO)
    print('Comprueba la recepcion final en el dashboard MaquiRent.')
    return True


def main():
    global PUERTO_COM, BROKER, PUERTO_MQTT, TOPICO
    parser = argparse.ArgumentParser(description='Puente Pico USB a MQTT para MaquiRent')
    parser.add_argument('--port', default=PUERTO_COM, help='Puerto serial, por ejemplo COM3')
    parser.add_argument('--broker', default=BROKER)
    parser.add_argument('--mqtt-port', type=int, default=PUERTO_MQTT)
    parser.add_argument('--topic', default=TOPICO, help='Mismo topico configurado en el dashboard')
    args = parser.parse_args()
    PUERTO_COM, BROKER, PUERTO_MQTT, TOPICO = args.port, args.broker, args.mqtt_port, args.topic
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='MaquiRent_Gateway_' + uuid.uuid4().hex[:8])
    ser = None
    loop_iniciado = False
    try:
        print(f'Conectando al broker {BROKER}:{PUERTO_MQTT}...')
        client.connect(BROKER, PUERTO_MQTT, 60)
        client.loop_start()
        loop_iniciado = True

        # Cerrar la consola de Thonny antes de abrir este mismo puerto.
        ser = serial.Serial(PUERTO_COM, BAUD_RATE, timeout=1)
        time.sleep(1)
        ser.write(b'\x02')  # Ctrl+B: REPL normal.
        time.sleep(0.5)
        ser.write(b'\x04')  # Ctrl+D: reinicio suave y ejecucion de main.py.
        print(f'Escuchando en {PUERTO_COM} y enviando a {TOPICO}...')

        while True:
            crudo = ser.readline()
            linea = crudo.decode('utf-8', errors='ignore').strip()
            if linea:
                print('[RECIBIDO DE PICO] ->', linea)
                publicar_linea(client, linea)
    except KeyboardInterrupt:
        print('\nDeteniendo gateway...')
    except (OSError, serial.SerialException) as error:
        print('[ERROR DE CONEXION O PUERTO]', error)
        print('Revisar la red y el puerto COM antes de reiniciar el gateway.')
    finally:
        if ser is not None and ser.is_open:
            ser.close()
        client.disconnect()
        if loop_iniciado:
            client.loop_stop()


if __name__ == '__main__':
    main()
