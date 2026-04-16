import serial
import serial.tools.list_ports
import asyncio
import websockets
import socket

# --- CONFIGURAÇÃO ---
BAUD_RATE = 9600
WS_PORT = 8082

def get_local_ip():
    """ 
    Descobre o IP local deste computador na rede local/Wi-Fi.
    """
    try:
        # Cria um socket UDP (não faz conexão real) para identificar a interface de rede ativa
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def find_arduino_port():
    """
    Busca automaticamente a porta USB onde o Arduino está conectado.
    """
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        desc = p.description or ""
        if any(term in desc for term in ["Arduino", "USB", "CH340", "CP210", "FT232", "ACM"]):
            print(f"[Sistema] Arduino identificado em: {p.device}")
            return p.device
    if ports:
        return ports[0].device
    return None

async def bridge(websocket):
    print(f"\n[Ponte] Celular conectado!")
    port = find_arduino_port()
    if not port:
        print("[Erro] Arduino não encontrado! Verifique o cabo USB.")
        return

    try:
        with serial.Serial(port, BAUD_RATE, timeout=0.1) as ser:
            print(f"[Ponte] Lendo Serial em {port}...")
            while True:
                if ser.in_waiting > 0:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line.startswith("RFID_UID:"):
                        uid = line.split(":")[1]
                        print(f"[Ponte] Cartão Lido: {uid}")
                        await websocket.send(uid)
                await asyncio.sleep(0.05)
    except Exception as e:
        print(f"[Erro] Falha na Serial: {e}")

async def main():
    my_ip = get_local_ip()
    print(f"==========================================")
    print(f"   PONTE PETROGATE RFID - AUTO CONFIG     ")
    print(f"==========================================")
    print(f" Seu IP Local: {my_ip}")
    print(f" Porta WebSocket: {WS_PORT}")
    print(f" URL para o App: ws://{my_ip}:{WS_PORT}")
    print(f"------------------------------------------")
    
    async with websockets.serve(bridge, "0.0.0.0", WS_PORT):
        print(f"[Status] Aguardando conexão do celular...")
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Ponte] Encerrando...")
