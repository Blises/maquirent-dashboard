import machine
import time
import onewire
import ds18x20
import ujson

# 1. Configuración de Sensores Locales
sensor_gasolina = machine.ADC(26)
pin_ds = machine.Pin(2, machine.Pin.IN, machine.Pin.PULL_UP)
bus_ow = onewire.OneWire(pin_ds)
ds_sensor = ds18x20.DS18X20(bus_ow)
roms = ds_sensor.scan()

# 2. Configuración del Módulo GPS NEO-6M (UART0)
# GP0 -> TX de la Pico conectado a RX del GPS
# GP1 -> RX de la Pico conectado a TX del GPS
uart_gps = machine.UART(0, baudrate=9600, tx=machine.Pin(0), rx=machine.Pin(1))

led = machine.Pin("LED", machine.Pin.OUT)

def leer_temperatura():
    if roms:
        try:
            ds_sensor.convert_temp()
            time.sleep_ms(750)
            return round(ds_sensor.read_temp(roms[0]), 2)
        except:
            return None
    # Una sonda ausente no representa una medicion de temperatura.
    return None

def leer_combustible():
    val = sensor_gasolina.read_u16()
    pct = (val / 45000.0) * 100.0
    return round(max(0.0, min(100.0, pct)), 1)

def parsear_coordenadas(nmea_cadena):
    """
    Parsea sentencias $GPRMC o $GNRMC.
    Si no hay fijacion satelital valida, devuelve coordenadas nulas.
    """
    partes = nmea_cadena.split(',')

    # Análisis de trama RMC: $GPRMC,hora,status,lat,N/S,lon,E/W,...
    if partes[0] in ["$GPRMC", "$GNRMC"]:
        if len(partes) > 6 and partes[2] == 'A':  # 'A' = Active (Fix alcanzado)
            lat = f"{partes[3]} {partes[4]}"
            lon = f"{partes[5]} {partes[6]}"
            return {"estado": "FIJADO", "latitud": lat, "longitud": lon}
        else:
            return {"estado": "BUSCANDO", "latitud": None, "longitud": None}

    return None

def obtener_datos_gps():
    # Drenar y leer las líneas pendientes en el buffer UART
    while uart_gps.any():
        try:
            linea = uart_gps.readline().decode('utf-8', 'ignore').strip()
            if linea.startswith("$GPRMC") or linea.startswith("$GNRMC"):
                parsed = parsear_coordenadas(linea)
                if parsed:
                    return parsed
        except:
            pass
    return {"estado": "SIN_SENAL_O_BUSCANDO", "latitud": None, "longitud": None}

print("Iniciando telemetría completa de maquinaria pesada...")

while True:
    temp = leer_temperatura()
    diesel = leer_combustible()
    gps_info = obtener_datos_gps()

    led.toggle()

    # Paquete consolidado de telemetría IoT
    telemetria = {
        "equipo_id": "EXCAVADORA-CAT-01",
        "agencia": "Arrendadora Maquinaria Pesada",
        "temp_motor": temp,
        "nivel_diesel_pct": diesel,
        "gps": gps_info,
        "alerta_temp": temp is not None and temp > 35.0,
        "alerta_combustible": diesel < 15.0
    }

    # Emisión serial en una sola línea JSON
    print(ujson.dumps(telemetria))
    time.sleep(2)
