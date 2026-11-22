import machine
import time
import onewire
import ds18x20
import ujson

# Inicialización de Sensores y Periféricos
sensor_nivel = machine.ADC(26)  # Sensor analógico de nivel de agua/combustible en GP26
pin_ds = machine.Pin(2, machine.Pin.IN, machine.Pin.PULL_UP)  # Bus 1-Wire en GP2
bus_ow = onewire.OneWire(pin_ds)
ds_sensor = ds18x20.DS18X20(bus_ow)
roms = ds_sensor.scan()

# GPS NEO-6M configurado en UART0 (GP0 TX -> RX GPS, GP1 RX -> TX GPS)
uart_gps = machine.UART(0, baudrate=9600, tx=machine.Pin(0), rx=machine.Pin(1))
led = machine.Pin("LED", machine.Pin.OUT)

def leer_temperatura():
    global roms
    if not roms:
        roms = ds_sensor.scan()
    if roms:
        try:
            ds_sensor.convert_temp()
            time.sleep_ms(750)
            return round(ds_sensor.read_temp(roms[0]), 2)
        except:
            return None
    # Sin sensor no existe una medición válida.
    return None

def leer_combustible():
    val = sensor_nivel.read_u16()
    # Zona muerta para eliminar ruido residual cuando el sensor está completamente seco
    if val < 4500:
        return 0.0
    pct = ((val - 4500) / (45000.0 - 4500)) * 100.0
    return round(max(0.0, min(100.0, pct)), 1)

def obtener_datos_gps():
    while uart_gps.any():
        try:
            linea = uart_gps.readline().decode('utf-8', 'ignore').strip()
            if linea.startswith("$GPRMC") or linea.startswith("$GNRMC"):
                partes = linea.split(',')
                if len(partes) > 6 and partes[2] == 'A':
                    return {
                        "estado": "FIJADO",
                        "latitud": f"{partes[3]} {partes[4]}",
                        "longitud": f"{partes[5]} {partes[6]}"
                    }
                else:
                    return {
                        "estado": "BUSCANDO",
                        "latitud": None,
                        "longitud": None
                    }
        except:
            pass
    return {
        "estado": "SIN_SENAL_O_BUSCANDO",
        "latitud": None,
        "longitud": None
    }

def evaluar_estado_operativo(temp, diesel):
    # Estado 3: CRÍTICO (Sobrecalentamiento > 35°C o Diésel < 15%)
    if (temp is not None and temp > 35.0) or (diesel is not None and diesel < 15.0):
        return "CRITICO"
    if temp is None or diesel is None:
        return "LECTURA_INCOMPLETA"
    # Estado 2: ADVERTENCIA (Temp entre 30°C y 35°C, o Diésel entre 15% y 25%)
    elif (temp is not None and temp >= 30.0) or diesel <= 25.0:
        return "ADVERTENCIA"
    # Estado 1: NORMAL
    else:
        return "NORMAL"

print("Iniciando telemetría completa de maquinaria pesada...")

while True:
    temp = leer_temperatura()
    diesel = leer_combustible()
    gps_info = obtener_datos_gps()
    estado_global = evaluar_estado_operativo(temp, diesel)
    led.toggle()

    telemetria = {
        "equipo_id": "EXCAVADORA-CAT-01",
        "agencia": "Arrendadora Maquinaria Pesada",
        "temp_motor": temp,
        "nivel_diesel_pct": diesel,
        "gps": gps_info,
        "estado_operativo": estado_global,
        "alerta_temp": temp is not None and temp > 35.0,
        "alerta_combustible": diesel < 15.0
    }

    print(ujson.dumps(telemetria))
    time.sleep(2)
