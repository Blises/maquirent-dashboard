"""Verifica el contrato de sensores sin abrir puertos ni ejecutar el bucle de la Pico."""
import ast
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


def functions_from(path, globals_):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)], type_ignores=[])
    exec(compile(functions, str(path), "exec"), globals_)
    return globals_


class FirmwareContract(unittest.TestCase):
    def test_dry_zone_and_calibration(self):
        scope = functions_from(ROOT / "firmware/main.py", {})
        for raw, expected in [(0, 0.0), (4499, 0.0), (4500, 0.0), (10575, 15.0),
                              (14625, 25.0), (24750, 50.0), (45000, 100.0), (65535, 100.0)]:
            with self.subTest(raw=raw):
                scope["sensor_nivel"] = SimpleNamespace(read_u16=lambda: raw)
                self.assertEqual(scope["leer_combustible"](), expected)

    def test_missing_sensor_and_recovery(self):
        ds = SimpleNamespace(scan=lambda: [], convert_temp=lambda: None, read_temp=lambda rom: 28.75)
        scope = functions_from(ROOT / "firmware/main.py", {
            "roms": [], "ds_sensor": ds, "time": SimpleNamespace(sleep_ms=lambda ms: None)
        })
        self.assertIsNone(scope["leer_temperatura"]())
        ds.scan = lambda: [b"probe"]
        self.assertEqual(scope["leer_temperatura"](), 28.75)
        ds.read_temp = lambda rom: (_ for _ in ()).throw(OSError("disconnected"))
        self.assertIsNone(scope["leer_temperatura"]())

    def test_firmware_and_dashboard_agree_at_boundaries(self):
        cases = [[t, f] for t in [None, 20, 29.99, 30, 35, 35.01]
                 for f in [None, 0, 14.99, 15, 25, 25.01, 70]]
        scope = functions_from(ROOT / "firmware/main.py", {})
        code = "const T=require('./assets/telemetry.js');process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(x=>T.classify(...x))));"
        result = subprocess.run(["node", "-e", code, json.dumps(cases)], cwd=ROOT,
                                capture_output=True, text=True, check=True)
        expected = [scope["evaluar_estado_operativo"](*case) for case in cases]
        self.assertEqual(json.loads(result.stdout), expected)


class GatewayContract(unittest.TestCase):
    def test_payload_preserves_state_and_sensor_values(self):
        scope = functions_from(ROOT / "gateway/gateway_mqtt.py", {"json": json})
        packet = {"equipo_id": "EXCAVADORA-CAT-01", "temp_motor": 30,
                  "nivel_diesel_pct": 25, "estado_operativo": "ADVERTENCIA",
                  "gps": {"estado": "BUSCANDO", "latitud": None, "longitud": None}}
        parsed = scope["extraer_json"](">>> " + json.dumps(packet))
        self.assertEqual(json.loads(parsed), packet)
        for line in ["Iniciando...", "{incompleto", "[]", '{"equipo_id":"otra-unidad"}']:
            self.assertIsNone(scope["extraer_json"](line))


if __name__ == "__main__":
    unittest.main()
