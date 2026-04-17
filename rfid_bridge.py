import serial
import serial.tools.list_ports
import asyncio
import websockets
import socket

# --- CONFIGURAÇÃO ---
BAUD_RATE = 9600
WS_PORT = 8082

connected_clients = set()

def get_local_ip():
    """ 
    Descobre o IP local deste computador na rede local/Wi-Fi.
    """
    try:
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

async def ws_handler(websocket):
    print(f"\n[Ponte] Celular conectado!")
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print(f"[Ponte] Celular desconectado.")

async def serial_reader():
    port = find_arduino_port()
    if not port:
        print("[Erro] Arduino não encontrado! Verifique o cabo USB.")
        return

    while True:
        try:
            with serial.Serial(port, BAUD_RATE, timeout=0.1) as ser:
                print(f"[Ponte] Lendo Serial em {port}...")
                while True:
                    if ser.in_waiting > 0:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        if line.startswith("RFID_UID:"):
                            uid = line.split(":")[1]
                            print(f"[Ponte] Cartão Lido: {uid}")
                            
                            # Envia apenas se houver clientes conectados (tela de login aberta)
                            if connected_clients:
                                for ws in list(connected_clients):
                                    try:
                                        await ws.send(uid)
                                    except Exception:
                                        pass
                            else:
                                print(f"[Ponte] (Ignorado) O app não está na tela de login.")
                    
                    await asyncio.sleep(0.05)
        except serial.SerialException as e:
            print(f"[Erro] Conexão Serial perdida: {e}. Tentando reconectar em 3s...")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"[Erro] Erro inesperado na Serial: {e}")
            await asyncio.sleep(3)

async def main():
    my_ip = get_local_ip()
    print(f"==========================================")
    print(f"   PONTE PETROGATE RFID - AUTO CONFIG     ")
    print(f"==========================================")
    print(f" Seu IP Local: {my_ip}")
    print(f" Porta WebSocket: {WS_PORT}")
    print(f" URL para o App: ws://{my_ip}:{WS_PORT}")
    print(f"------------------------------------------")
    
    # Inicia o servidor websocket em background
    server = await websockets.serve(ws_handler, "0.0.0.0", WS_PORT)
    
    # Inicia a leitura da serial (loop infinito)
    await serial_reader()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Ponte] Encerrando...")
