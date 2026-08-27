/*
 * Aqua Alert - ESP8266 + sensor de vazao YF-S201
 *
 * Placa: NodeMCU/ESP8266
 * Sensor: sinal no pino D2 (GPIO4), VCC em 5V e GND comum.
 */
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

const char *API_URL = "https://aqua-alert-api.davipizabel.workers.dev/api/leituras";
const char *PORTAL_SSID = "AquaAlert_Config";
const char *PORTAL_PASSWORD = "12345678";

const byte SENSOR_PIN = D2;
const unsigned long MEASUREMENT_INTERVAL_MS = 5000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 30000;
const float PULSES_PER_LITER = 450.0f; // Calibre este valor caso o sensor usado seja diferente.

// 32 bytes para SSID, 64 para senha e 6 para a chave de cinco digitos.
const int EEPROM_SIZE = 112;
const int SSID_ADDR = 0;
const int SSID_MAX_LENGTH = 32;
const int PASSWORD_ADDR = SSID_ADDR + SSID_MAX_LENGTH;
const int PASSWORD_MAX_LENGTH = 64;
const int DEVICE_KEY_ADDR = PASSWORD_ADDR + PASSWORD_MAX_LENGTH;
const int DEVICE_KEY_MAX_LENGTH = 6;

const byte DNS_PORT = 53;
ESP8266WebServer server(80);
DNSServer dnsServer;

String savedSSID;
String savedPassword;
String savedDeviceKey;
volatile unsigned long pulseCount = 0;
unsigned long lastMeasurementAt = 0;
unsigned long lastWiFiRetryAt = 0;
float pendingLiters = 0.0f;
bool portalRunning = false;

void IRAM_ATTR countPulse() {
  pulseCount++;
}

String readEEPROMString(int start, int maxLength) {
  String value;
  for (int i = 0; i < maxLength; i++) {
    const char character = static_cast<char>(EEPROM.read(start + i));
    if (character == '\0' || character == static_cast<char>(0xFF)) break;
    value += character;
  }
  return value;
}

void writeEEPROMString(int start, int maxLength, const String &value) {
  for (int i = 0; i < maxLength; i++) {
    EEPROM.write(start + i, i < value.length() ? value[i] : '\0');
  }
}

void loadConfiguration() {
  savedSSID = readEEPROMString(SSID_ADDR, SSID_MAX_LENGTH);
  savedPassword = readEEPROMString(PASSWORD_ADDR, PASSWORD_MAX_LENGTH);
  savedDeviceKey = readEEPROMString(DEVICE_KEY_ADDR, DEVICE_KEY_MAX_LENGTH);
}

void saveConfiguration(const String &ssid, const String &password, const String &deviceKey) {
  writeEEPROMString(SSID_ADDR, SSID_MAX_LENGTH, ssid);
  writeEEPROMString(PASSWORD_ADDR, PASSWORD_MAX_LENGTH, password);
  writeEEPROMString(DEVICE_KEY_ADDR, DEVICE_KEY_MAX_LENGTH, deviceKey);
  EEPROM.commit();
}

void clearConfiguration() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0);
  EEPROM.commit();
}

bool hasValidDeviceKey(const String &key) {
  if (key.length() != 5) return false;
  for (unsigned int i = 0; i < key.length(); i++) {
    if (!isDigit(key[i])) return false;
  }
  return true;
}

bool connectToSavedWiFi() {
  if (savedSSID.length() == 0 || !hasValidDeviceKey(savedDeviceKey)) {
    Serial.println("Wi-Fi ou chave do ESP nao configurados.");
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSSID.c_str(), savedPassword.c_str());
  Serial.printf("Conectando ao Wi-Fi '%s'", savedSSID.c_str());

  for (int attempts = 0; WiFi.status() != WL_CONNECTED && attempts < 20; attempts++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Nao foi possivel conectar ao Wi-Fi salvo.");
    return false;
  }

  Serial.print("Wi-Fi conectado. IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

String configurationPage(const String &message = "") {
  String html = R"rawliteral(
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Configurar Aqua Alert</title><style>body{font-family:Arial,sans-serif;background:#eef5f7;margin:0;padding:20px}.box{max-width:420px;margin:30px auto;background:#fff;padding:24px;border-radius:14px;box-shadow:0 6px 20px #0002}h1{font-size:22px}label{display:block;margin-top:14px;font-weight:bold}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:6px;border-radius:8px;font-size:16px}input{border:1px solid #b8c6cb}button{border:0;background:#087f8c;color:#fff;font-weight:bold}.message{padding:10px;border-radius:8px;background:#e2f3f5;color:#075b63}.danger{display:block;margin-top:18px;color:#a52222;text-align:center}</style></head><body><main class="box"><h1>Configurar Aqua Alert</h1><p>Use a chave de cinco digitos mostrada pelo site ao criar sua conta.</p>
)rawliteral";
  if (message.length()) html += "<p class=\"message\">" + message + "</p>";
  html += R"rawliteral(
<form action="/save" method="post"><label>Nome da rede Wi-Fi (SSID)<input name="ssid" maxlength="31" required></label><label>Senha da rede Wi-Fi<input type="password" name="password" maxlength="63"></label><label>Chave do ESP<input name="device_key" inputmode="numeric" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label><button type="submit">Salvar e conectar</button></form><a class="danger" href="/reset">Apagar configuracao salva</a></main></body></html>
)rawliteral";
  return html;
}

void handleRoot() {
  server.send(200, "text/html; charset=utf-8", configurationPage());
}

void handleSave() {
  const String ssid = server.arg("ssid");
  const String password = server.arg("password");
  const String deviceKey = server.arg("device_key");
  if (ssid.length() == 0 || ssid.length() >= SSID_MAX_LENGTH || password.length() >= PASSWORD_MAX_LENGTH || !hasValidDeviceKey(deviceKey)) {
    server.send(400, "text/html; charset=utf-8", configurationPage("Confira o SSID, a senha e a chave de cinco digitos."));
    return;
  }
  saveConfiguration(ssid, password, deviceKey);
  server.send(200, "text/html; charset=utf-8", "<html><body><h2>Configuracao salva.</h2><p>O ESP sera reiniciado e iniciara a medicao.</p></body></html>");
  delay(1500);
  ESP.restart();
}

void handleReset() {
  clearConfiguration();
  server.send(200, "text/html; charset=utf-8", "<html><body><h2>Configuracao apagada.</h2><p>Reiniciando...</p></body></html>");
  delay(1500);
  ESP.restart();
}

void startConfigurationPortal() {
  if (portalRunning) return;
  portalRunning = true;
  WiFi.disconnect();
  delay(200);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(PORTAL_SSID, PORTAL_PASSWORD);
  const IPAddress portalIP = WiFi.softAPIP();
  dnsServer.start(DNS_PORT, "*", portalIP);
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/reset", handleReset);
  server.on("/generate_204", handleRoot);       // Android
  server.on("/fwlink", handleRoot);             // Windows
  server.on("/hotspot-detect.html", handleRoot); // Apple
  server.onNotFound(handleRoot);
  server.begin();
  Serial.println("Portal de configuracao iniciado.");
  Serial.printf("Rede: %s | Senha: %s | IP: %s\n", PORTAL_SSID, PORTAL_PASSWORD, portalIP.toString().c_str());
}

void processConfigurationPortal() {
  dnsServer.processNextRequest();
  server.handleClient();
}

void sendReading(float liters, float flowLpm) {
  if (WiFi.status() != WL_CONNECTED || !hasValidDeviceKey(savedDeviceKey)) return;
  BearSSL::WiFiClientSecure client;
  client.setInsecure(); // A API usa HTTPS; para validar o certificado, substitua por um trust anchor atualizado.
  HTTPClient http;
  if (!http.begin(client, API_URL)) {
    Serial.println("Falha ao iniciar conexao HTTP.");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", savedDeviceKey);
  const String payload = "{\"litros\":" + String(liters, 4) + ",\"fluxo\":" + String(flowLpm, 2) + ",\"intervalo_segundos\":5}";
  const int responseCode = http.POST(payload);
  Serial.printf("Envio para API: HTTP %d | %s\n", responseCode, payload.c_str());
  http.end();
  if (responseCode >= 200 && responseCode < 300) pendingLiters = 0.0f;
}

void measureAndSend() {
  noInterrupts();
  const unsigned long pulses = pulseCount;
  pulseCount = 0;
  interrupts();

  const float intervalLiters = pulses / PULSES_PER_LITER;
  pendingLiters += intervalLiters;
  const float flowLpm = intervalLiters * (60000.0f / MEASUREMENT_INTERVAL_MS);
  Serial.printf("Pulsos: %lu | Vazao: %.2f L/min | Pendente: %.4f L\n", pulses, flowLpm, pendingLiters);
  sendReading(pendingLiters, flowLpm);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(SENSOR_PIN), countPulse, RISING);
  EEPROM.begin(EEPROM_SIZE);
  loadConfiguration();
  lastMeasurementAt = millis();
  lastWiFiRetryAt = millis();

  if (!connectToSavedWiFi()) startConfigurationPortal();
}

void loop() {
  if (portalRunning) {
    processConfigurationPortal();
    return;
  }

  const unsigned long now = millis();
  if (now - lastMeasurementAt >= MEASUREMENT_INTERVAL_MS) {
    lastMeasurementAt = now;
    measureAndSend();
  }
  if (WiFi.status() != WL_CONNECTED && now - lastWiFiRetryAt >= WIFI_RETRY_INTERVAL_MS) {
    lastWiFiRetryAt = now;
    if (!connectToSavedWiFi()) startConfigurationPortal();
  }
}
