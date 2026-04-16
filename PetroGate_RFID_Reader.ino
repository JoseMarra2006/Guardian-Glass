/**
 * @file PetroGate_RFID_Reader.ino
 * @description Firmware para leitura de cartões RFID RC522 com feedback visual via Serial.
 */

#include <SPI.h>
#include <MFRC522.h>

// Definição dos pinos para o Arduino UNO
#define SS_PIN 10
#define RST_PIN 9

MFRC522 rfid(SS_PIN, RST_PIN);

void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  
  Serial.println("------------------------------------");
  Serial.println("   SISTEMA PETROGATE RFID PRONTO    ");
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
