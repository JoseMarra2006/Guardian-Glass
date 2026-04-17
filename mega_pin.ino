/**
 * @file mega_pin.ino
 * @description Firmware para leitura de cartões RFID RC522 com Arduino Mega 2560 e feedback visual via Serial.
 */

#include <SPI.h>
#include <MFRC522.h>

// Definição dos pinos para o Arduino Mega 2560
// VCC: 3.3V (Não use 5V!)
// GND: GND
// MISO: 50
// MOSI: 51
// SCK:  52
#define SS_PIN 53
#define RST_PIN 5

MFRC522 rfid(SS_PIN, RST_PIN);

void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  
  Serial.println("------------------------------------");
  Serial.println("   SISTEMA PETROGATE RFID PRONTO    ");
  Serial.println("            (MEGA 2560)             ");
  Serial.println("------------------------------------");
  Serial.println("Aguardando leitura de cartao...");
}

void loop() {
  // Procura por novos cartões
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  // Tenta ler o cartão selecionado
  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("[ERRO] Falha ao ler o cartao.");
    return;
  }

  // Converte o UID para String Hexadecimal formatada
  String uidStr = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    uidStr += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
    uidStr += String(rfid.uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();

  // FEEDBACK NO MONITOR SERIAL
  Serial.println("\n>>> CARTAO DETECTADO! <<<");
  Serial.print("ID DO CARTAO: ");
  Serial.println(uidStr);
  
  // ENVIO PARA O APP (O prefixo 'RFID_UID:' é o que o celular reconhece)
  Serial.print("RFID_UID:");
  Serial.println(uidStr);
  Serial.println("Status: Enviado para Guardian Glass App.");

  // Finaliza a comunicação com o cartão
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  Serial.println("\nPronto para a proxima leitura...");
  
  // Delay de 1.5 segundos para evitar leituras duplicadas rápidas
  delay(1500);
}
